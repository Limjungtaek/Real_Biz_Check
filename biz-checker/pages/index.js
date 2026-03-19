import { useState, useRef, useCallback, useEffect } from "react";
import Head from "next/head";
import * as XLSX from "xlsx";

// ── Constants ──────────────────────────────────────────
const CHIP = { "01": "chip-active", "02": "chip-susp", "03": "chip-closed" };
const LABEL = { "01": "계속사업자", "02": "휴업자", "03": "폐업자" };

const STEPS = [
  { id: 1, label: "번호 파싱",   sub: "입력 데이터 정제" },
  { id: 2, label: "API 전송",    sub: "국세청 서버 요청" },
  { id: 3, label: "결과 처리",   sub: "데이터 변환 중" },
  { id: 4, label: "완료",        sub: "조회 성공" },
];

const FILTERS = [
  { key: "all",     label: "전체" },
  { key: "01",      label: "계속사업자" },
  { key: "02",      label: "휴업자" },
  { key: "03",      label: "폐업자" },
  { key: "unknown", label: "알 수 없음" },
];

// ── Helpers ────────────────────────────────────────────
function parseBizNumbers(text) {
  return text
    .split(/[\n,;|\t]+/)
    .map((s) => s.replace(/[^0-9]/g, ""))
    .filter((s) => s.length > 0);
}

function fmtBizNum(n) {
  const s = String(n).replace(/[^0-9]/g, "");
  if (s.length !== 10) return n;
  return `${s.slice(0,3)}-${s.slice(3,5)}-${s.slice(5)}`;
}

function fmtDate(d) {
  if (!d || d.length < 8) return "-";
  return `${d.slice(0,4)}.${d.slice(4,6)}.${d.slice(6)}`;
}

function exportCSV(results) {
  const header = ["순번", "사업자번호", "상태", "과세유형", "폐업일"];
  const rows = results.map((r, i) => [
    i + 1, r.businessNumber, r.label, r.taxType || "-", r.closedAt ? fmtDate(r.closedAt) : "-",
  ]);
  const csv = "\uFEFF" + [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `사업자상태조회_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// xlsx/xlsm/csv/txt 파싱
async function parseFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();

  if (ext === "txt") {
    return new Promise((res) => {
      const reader = new FileReader();
      reader.onload = (e) => res(e.target.result);
      reader.readAsText(file, "utf-8");
    });
  }

  if (ext === "csv") {
    return new Promise((res) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const nums = (e.target.result || "")
          .split(/[\n,]+/)
          .map((s) => s.replace(/[^0-9]/g, ""))
          .filter(Boolean);
        res(nums.join("\n"));
      };
      reader.readAsText(file, "utf-8");
    });
  }

  if (ext === "xlsx" || ext === "xlsm" || ext === "xls") {
    return new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = XLSX.read(e.target.result, { type: "array" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const data = XLSX.utils.sheet_to_json(ws, { header: 1 });
          const nums = [];
          data.forEach((row) => {
            (row || []).forEach((cell) => {
              const s = String(cell || "").replace(/[^0-9]/g, "");
              if (s.length >= 9) nums.push(s);
            });
          });
          res(nums.join("\n"));
        } catch (err) {
          rej(new Error("파일을 읽는 중 오류가 발생했습니다."));
        }
      };
      reader.readAsArrayBuffer(file);
    });
  }

  throw new Error("지원하지 않는 파일 형식입니다.");
}

// ── Component ──────────────────────────────────────────
export default function Home() {
  const [text, setText] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [dragOver, setDragOver] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("");
  const [exImages, setExImages] = useState([]); // manifest.json에서 로드
  const [exLoading, setExLoading] = useState(true);
  const [modalImg, setModalImg] = useState(null);
  const fileRef = useRef();

  const parsedNumbers = parseBizNumbers(text);
  const uniqueNumbers = [...new Set(parsedNumbers)];

  // ── 예시 이미지 manifest.json 로드 ──
  useEffect(() => {
    fetch("/examples/manifest.json")
      .then((res) => {
        if (!res.ok) throw new Error("not found");
        return res.json();
      })
      .then((data) => {
        setExImages(data.images || []);
      })
      .catch(() => {
        setExImages([]);
      })
      .finally(() => {
        setExLoading(false);
      });
  }, []);

  // ── File upload ──
  const handleFile = useCallback(async (file) => {
    if (!file) return;
    try {
      setUploadedFile(file.name);
      const result = await parseFile(file);
      setText((prev) => (prev ? prev + "\n" + result : result));
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  // ── API call with step progress (100건 초과 자동 분할) ──
  const handleCheck = async () => {
    if (uniqueNumbers.length === 0) return;
    setLoading(true); setError(null); setResults(null); setFilter("all");

    const totalCount = uniqueNumbers.length;
    const totalChunks = Math.ceil(totalCount / 100);

    // Step 1: 번호 파싱
    setCurrentStep(1); setProgress(10);
    setProgressText(`${totalCount}개 번호 정제 중...`);
    await new Promise((r) => setTimeout(r, 400));
    setProgress(25);

    // Step 2: API 전송
    setCurrentStep(2); setProgress(35);
    setProgressText(
      totalChunks > 1
        ? `${totalChunks}개 묶음으로 분할 전송 중... (총 ${totalCount}건)`
        : `${totalCount}건 전송 중...`
    );

    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessNumbers: uniqueNumbers }),
      });

      // Step 3: 결과 처리
      setCurrentStep(3); setProgress(75);
      setProgressText("응답 데이터 처리 중...");
      await new Promise((r) => setTimeout(r, 300));

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "조회 중 오류가 발생했습니다.");
        setCurrentStep(0); setProgress(0); setProgressText("");
      } else {
        setProgress(100);
        setCurrentStep(4);
        setProgressText(
          data.chunks > 1
            ? `${data.count}건 조회 완료 (${data.chunks}회 분할 처리)`
            : `${data.count}건 조회 완료`
        );
        await new Promise((r) => setTimeout(r, 500));
        setResults(data.results);
        setCurrentStep(0); setProgress(0); setProgressText("");
      }
    } catch {
      setError("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
      setCurrentStep(0); setProgress(0); setProgressText("");
    } finally {
      setLoading(false);
    }
  };

  // ── Filter ──
  const filteredResults = results
    ? filter === "all" ? results
    : filter === "unknown" ? results.filter((r) => !["01","02","03"].includes(r.statusCode))
    : results.filter((r) => r.statusCode === filter)
    : [];

  const stats = results ? {
    total: results.length,
    active: results.filter((r) => r.statusCode === "01").length,
    susp:   results.filter((r) => r.statusCode === "02").length,
    closed: results.filter((r) => r.statusCode === "03").length,
  } : null;

  const pct = (n) => stats?.total ? Math.round((n / stats.total) * 100) : 0;

  // ── Render ──
  return (
    <>
      <Head>
        <title>사업자 상태 일괄 조회</title>
        <meta name="description" content="국세청 사업자 상태(계속·휴업·폐업) 일괄 조회 서비스" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>

      {/* Image modal */}
      {modalImg && (
        <div className="modal-overlay" onClick={() => setModalImg(null)}>
          <button className="modal-close" onClick={() => setModalImg(null)}>✕</button>
          <img src={modalImg} alt="예시 이미지" onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      <div className="page">
        {/* ── Header ── */}
        <header className="header">
          <div className="header-top">
            <div>
              <div className="tag-row">
                <span className="tag tag-api">NTS Open API</span>
                <span className="tag tag-live"><span className="dot" />실시간 조회</span>
              </div>
              <h1>사업자 상태<br /><em>일괄 조회</em></h1>
              <p className="sub">
                국세청 공공데이터 API 기반 · 계속사업자 / 휴업 / 폐업 실시간 확인<br />
                최대 10,000건 동시 조회 · 100건 단위 자동 분할 · xlsx / csv / txt 파일 지원
              </p>
            </div>
            <div className="header-badges">
              <div className="badge"><span className="icon">🏛️</span>국세청 NTS API 연동</div>
              <div className="badge"><span className="icon">🔒</span>API 키 서버 보호</div>
              <div className="badge"><span className="icon">⚡</span>최대 10,000건 자동 분할</div>
            </div>
          </div>
        </header>

        {/* ── Input grid ── */}
        <div className="main-grid">
          {/* 직접 입력 */}
          <div className="card">
            <div className="card-label"><span className="num">01</span> 사업자번호 직접 입력</div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={"1234567890\n123-45-67890\n234-56-78901, 345-67-89012\n\n줄바꿈·쉼표·탭으로 구분\n하이픈 포함/미포함 모두 가능"}
              spellCheck={false}
            />
            <div className="textarea-footer">
              <span className="hint">숫자 외 문자는 자동 제거됩니다</span>
              {uniqueNumbers.length > 0 && (
                <span className={`count-pill${uniqueNumbers.length > 100 ? " count-pill-chunk" : ""}`}>
                  {uniqueNumbers.length}개 인식됨
                  {uniqueNumbers.length > 100 && (
                    <span className="chunk-info"> · {Math.ceil(uniqueNumbers.length / 100)}회 분할</span>
                  )}
                </span>
              )}
            </div>
          </div>

          {/* 파일 업로드 */}
          <div className="card">
            <div className="card-label"><span className="num">02</span> 파일 업로드</div>
            <div
              className={`upload-zone${dragOver ? " drag" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.csv,.xlsx,.xlsm,.xls"
                onChange={(e) => handleFile(e.target.files[0])}
              />
              <div className="uicon">📂</div>
              {uploadedFile ? (
                <div className="file-chip">
                  <span>✅</span> {uploadedFile}
                </div>
              ) : (
                <>
                  <div className="upload-title"><span>클릭</span>하거나 파일을 끌어다 놓으세요</div>
                  <div className="upload-sub">.xlsx · .xlsm · .xls · .csv · .txt</div>
                </>
              )}
            </div>

            {/* 파일 형식 안내 */}
            <div style={{ marginTop: 14, padding: "12px 14px", background: "var(--surface2)", borderRadius: "var(--r-sm)", border: "1px solid var(--border)" }}>
              <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 8 }}>지원 형식</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[".xlsx", ".xlsm", ".csv", ".txt"].map((ext) => (
                  <span key={ext} style={{ fontFamily: "var(--mono)", fontSize: 11, padding: "2px 8px", background: "var(--surface3)", border: "1px solid var(--border2)", borderRadius: 4, color: "var(--text2)" }}>
                    {ext}
                  </span>
                ))}
              </div>
              <div style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--text3)", marginTop: 8, lineHeight: 1.6 }}>
                엑셀: 첫 번째 시트에서 10자리 숫자 자동 추출
              </div>
            </div>
          </div>
        </div>

        {/* ── Example images (서버에서 로드) ── */}
        {!exLoading && exImages.length > 0 && (
          <div className="example-section">
            <div className="card">
              <div className="card-label"><span className="num">03</span> 입력 예시 참고 이미지</div>
              <div className="example-grid">
                {exImages.map((img, i) => (
                  <div
                    key={i}
                    className="ex-img-wrap"
                    onClick={() => setModalImg(`/examples/${img.file}`)}
                    title={img.caption || img.file}
                  >
                    <img src={`/examples/${img.file}`} alt={img.caption || img.file} />
                    {img.caption && <div className="ex-caption">{img.caption}</div>}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Actions ── */}
        <div className="action-row">
          <button
            className="btn btn-primary"
            onClick={handleCheck}
            disabled={loading || uniqueNumbers.length === 0}
          >
            {loading ? (
              <><span>⏳</span> 조회 중…</>
            ) : (
              <>
                <span>🔍</span> 일괄 조회 ({uniqueNumbers.length}건)
                {uniqueNumbers.length > 100 && (
                  <span style={{ opacity: 0.7, fontSize: 12, marginLeft: 4 }}>
                    · {Math.ceil(uniqueNumbers.length / 100)}회 분할
                  </span>
                )}
              </>
            )}
          </button>
          {results && (
            <button className="btn btn-outline" onClick={() => exportCSV(results)}>
              <span>⬇</span> CSV 다운로드
            </button>
          )}
          {(text || results) && (
            <button className="btn btn-ghost" onClick={() => {
              setText(""); setResults(null); setError(null);
              setUploadedFile(null); setFilter("all");
            }}>
              초기화
            </button>
          )}
        </div>

        {/* ── Progress ── */}
        {loading && (
          <div className="progress-wrap">
            <div className="progress-steps">
              {STEPS.map((s) => (
                <div
                  key={s.id}
                  className={`pstep${currentStep === s.id ? " active" : ""}${currentStep > s.id ? " done" : ""}`}
                >
                  <div className="pstep-icon">
                    {currentStep > s.id ? "✓" : s.id}
                  </div>
                  <div className="pstep-text">
                    <span className="pstep-label">{s.label}</span>
                    <span className="pstep-sub">{currentStep === s.id && progressText ? progressText : s.sub}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="pbar-wrap">
              <div className="pbar-fill" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="error-box">
            <span>⚠️</span><span>{error}</span>
          </div>
        )}

        {/* ── Results ── */}
        {results && (
          <section className="results-section">
            {/* Stats */}
            <div className="stats-grid">
              <div className="stat-card s-total">
                <span className="stat-num">{stats.total}</span>
                <span className="stat-label">전체</span>
              </div>
              <div className="stat-card s-active">
                <span className="stat-num">{stats.active}</span>
                <span className="stat-label">계속사업자</span>
                <span className="stat-pct">{pct(stats.active)}%</span>
              </div>
              <div className="stat-card s-susp">
                <span className="stat-num">{stats.susp}</span>
                <span className="stat-label">휴업자</span>
                <span className="stat-pct">{pct(stats.susp)}%</span>
              </div>
              <div className="stat-card s-closed">
                <span className="stat-num">{stats.closed}</span>
                <span className="stat-label">폐업자</span>
                <span className="stat-pct">{pct(stats.closed)}%</span>
              </div>
            </div>

            {/* Filters */}
            <div className="filter-row">
              {FILTERS.map((f) => {
                const cnt = f.key === "all" ? results.length
                  : f.key === "unknown" ? results.filter((r) => !["01","02","03"].includes(r.statusCode)).length
                  : results.filter((r) => r.statusCode === f.key).length;
                return (
                  <button
                    key={f.key}
                    className={`ftab${filter === f.key ? " on" : ""}`}
                    onClick={() => setFilter(f.key)}
                  >
                    {f.label} ({cnt})
                  </button>
                );
              })}
            </div>

            {/* Table */}
            {filteredResults.length === 0 ? (
              <div className="empty-state">
                <div className="ei">🔎</div>
                <p>해당 조건의 결과가 없습니다.</p>
              </div>
            ) : (
              <div className="tbl-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>사업자번호</th>
                      <th>상태</th>
                      <th>과세유형</th>
                      <th>폐업일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredResults.map((r, i) => (
                      <tr key={r.rawNumber}>
                        <td><span className="idx">{i + 1}</span></td>
                        <td><span className="biz-num">{r.businessNumber}</span></td>
                        <td>
                          <span className={`chip ${CHIP[r.statusCode] || "chip-unknown"}`}>
                            {r.label}
                          </span>
                        </td>
                        <td><span className="tax">{r.taxType || "-"}</span></td>
                        <td><span className="date">{r.closedAt ? fmtDate(r.closedAt) : "-"}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {/* ── Footer ── */}
        <footer className="footer">
          <p>
            본 서비스는{" "}
            <a href="https://www.data.go.kr/data/15081808/openapi.do" target="_blank" rel="noopener noreferrer">
              공공데이터포털 국세청 사업자 상태조회 API
            </a>를 이용합니다.
            <br />
            조회 결과는 참고용이며 법적 효력이 없습니다. · 최대 10,000건 / 1회 (100건 단위 자동 분할)
          </p>
        </footer>
      </div>
    </>
  );
}
