import { useState, useRef, useCallback } from "react";
import Head from "next/head";

const STATUS_CLASS = {
  "01": "status-active",
  "02": "status-suspended",
  "03": "status-closed",
};

const FILTERS = [
  { key: "all", label: "전체" },
  { key: "01", label: "계속사업자" },
  { key: "02", label: "휴업자" },
  { key: "03", label: "폐업자" },
  { key: "unknown", label: "알 수 없음" },
];

// 사업자번호 파싱 (공백, 쉼표, 개행, 하이픈 등 구분자 허용)
function parseBizNumbers(text) {
  return text
    .split(/[\n,;|\t]+/)
    .map((s) => s.replace(/[^0-9]/g, ""))
    .filter((s) => s.length > 0);
}

// 엑셀 내보내기 (xlsx 없이 CSV 방식)
function exportCSV(results) {
  const header = ["순번", "사업자번호", "상태", "과세유형", "폐업일"];
  const rows = results.map((r, i) => [
    i + 1,
    r.businessNumber,
    r.label,
    r.taxType || "-",
    r.closedAt || "-",
  ]);
  const csv =
    "\uFEFF" + // BOM for Korean
    [header, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `사업자상태조회_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function Home() {
  const [text, setText] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  const parsedNumbers = parseBizNumbers(text);
  const uniqueNumbers = [...new Set(parsedNumbers)];

  // 파일 읽기 (txt, csv)
  const handleFile = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      setText((prev) => (prev ? prev + "\n" + e.target.result : e.target.result));
    };
    reader.readAsText(file, "utf-8");
  }, []);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  // API 조회
  const handleCheck = async () => {
    if (uniqueNumbers.length === 0) return;
    setLoading(true);
    setError(null);
    setResults(null);
    setFilter("all");

    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessNumbers: uniqueNumbers }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "조회 중 오류가 발생했습니다.");
      } else {
        setResults(data.results);
      }
    } catch {
      setError("네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요.");
    } finally {
      setLoading(false);
    }
  };

  // 필터링
  const filteredResults = results
    ? filter === "all"
      ? results
      : filter === "unknown"
      ? results.filter((r) => !["01", "02", "03"].includes(r.statusCode))
      : results.filter((r) => r.statusCode === filter)
    : [];

  // 통계
  const stats = results
    ? {
        total: results.length,
        active: results.filter((r) => r.statusCode === "01").length,
        suspended: results.filter((r) => r.statusCode === "02").length,
        closed: results.filter((r) => r.statusCode === "03").length,
      }
    : null;

  return (
    <>
      <Head>
        <title>사업자 상태 일괄 조회</title>
        <meta name="description" content="국세청 사업자 상태(계속·휴업·폐업)를 한번에 일괄 조회하는 서비스" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <div className="container">
        {/* ── Header ── */}
        <header className="header">
          <div className="header-inner">
            <div className="logo-area">
              <div className="logo-badge">
                <span className="logo-dot">🏢</span>
                <span>NTS OPEN API</span>
              </div>
              <h1>
                사업자 상태<br />
                <span className="accent-word">일괄 조회</span>
              </h1>
              <p className="header-desc">
                국세청 공공데이터 API 기반 · 계속사업자 / 휴업 / 폐업 확인
              </p>
            </div>
            <div className="header-meta">
              <div className="api-badge">
                <span className="dot" />
                국세청 NTS API 연동
              </div>
              <div className="api-badge">
                최대 100건 동시 조회
              </div>
            </div>
          </div>
        </header>

        {/* ── Input ── */}
        <section className="input-section">
          <div>
            <div className="section-label">사업자번호 입력</div>
            <div className="card">
              <div className="textarea-wrapper">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder={"1234567890\n234-56-78901\n345-67-89012, 456-78-90123\n\n• 줄바꿈, 쉼표, 탭으로 구분\n• 하이픈(-) 포함/미포함 모두 가능"}
                  spellCheck={false}
                />
              </div>
              <div className="textarea-hint">
                <span className="hint-text">숫자 외 문자는 자동으로 제거됩니다</span>
                {uniqueNumbers.length > 0 && (
                  <span className="count-badge">
                    {uniqueNumbers.length}개 인식됨
                  </span>
                )}
              </div>
            </div>
          </div>

          <div>
            <div className="section-label">파일 업로드 (선택)</div>
            <div
              className={`upload-area${dragOver ? " drag-over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.csv"
                onChange={(e) => handleFile(e.target.files[0])}
              />
              <div className="upload-icon">📄</div>
              <div className="upload-text">
                <strong>클릭하거나 파일을 끌어다 놓으세요</strong>
              </div>
              <div className="upload-sub">.txt · .csv 파일 지원</div>
            </div>
          </div>
        </section>

        {/* ── Actions ── */}
        <div className="actions">
          <button
            className="btn btn-primary"
            onClick={handleCheck}
            disabled={loading || uniqueNumbers.length === 0}
          >
            {loading ? (
              <>
                <span>⏳</span> 조회 중…
              </>
            ) : (
              <>
                <span>🔍</span> 일괄 조회 ({uniqueNumbers.length}건)
              </>
            )}
          </button>

          {results && (
            <button
              className="btn btn-secondary"
              onClick={() => exportCSV(results)}
            >
              <span>⬇</span> CSV 다운로드
            </button>
          )}

          {(text || results) && (
            <button
              className="btn btn-ghost"
              onClick={() => { setText(""); setResults(null); setError(null); }}
            >
              초기화
            </button>
          )}
        </div>

        {/* ── Loading bar ── */}
        {loading && (
          <div className="loading-bar">
            <div className="loading-bar-fill" />
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="error-box">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {/* ── Results ── */}
        {results && (
          <section className="results-section">
            {/* Stats */}
            <div className="stats-row">
              <div className="stat-card total">
                <span className="stat-num">{stats.total}</span>
                <span className="stat-label">전체</span>
              </div>
              <div className="stat-card active">
                <span className="stat-num">{stats.active}</span>
                <span className="stat-label">계속사업자</span>
              </div>
              <div className="stat-card suspended">
                <span className="stat-num">{stats.suspended}</span>
                <span className="stat-label">휴업자</span>
              </div>
              <div className="stat-card closed">
                <span className="stat-num">{stats.closed}</span>
                <span className="stat-label">폐업자</span>
              </div>
            </div>

            {/* Filter tabs */}
            <div className="filter-tabs">
              {FILTERS.map((f) => (
                <button
                  key={f.key}
                  className={`filter-tab${filter === f.key ? " active" : ""}`}
                  onClick={() => setFilter(f.key)}
                >
                  {f.label}
                  {f.key !== "all" && results && (
                    <> (
                      {f.key === "unknown"
                        ? results.filter((r) => !["01", "02", "03"].includes(r.statusCode)).length
                        : results.filter((r) => r.statusCode === f.key).length}
                    )</>
                  )}
                </button>
              ))}
            </div>

            {/* Table */}
            <div className="results-header">
              <span className="results-title">
                {filteredResults.length}건 표시됨
              </span>
            </div>

            {filteredResults.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🔎</div>
                <div className="empty-text">해당 조건의 결과가 없습니다.</div>
              </div>
            ) : (
              <div className="table-wrapper">
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
                          <span className={`status-chip ${STATUS_CLASS[r.statusCode] || "status-unknown"}`}>
                            {r.label}
                          </span>
                        </td>
                        <td>
                          <span className="tax-type">
                            {r.taxType || "-"}
                          </span>
                        </td>
                        <td>
                          <span className="closed-date">
                            {r.closedAt
                              ? `${r.closedAt.slice(0, 4)}.${r.closedAt.slice(4, 6)}.${r.closedAt.slice(6)}`
                              : "-"}
                          </span>
                        </td>
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
            </a>
            를 이용합니다.
            <br />
            조회 결과는 참고용이며 법적 효력이 없습니다. · 최대 100건 / 1회
          </p>
        </footer>
      </div>
    </>
  );
}
