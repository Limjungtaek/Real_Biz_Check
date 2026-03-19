// pages/api/check.js
// 국세청 사업자 상태조회 API 프록시 라우트
// API 키를 서버사이드에서 보호합니다
// 100건 초과 시 자동으로 분할 요청합니다

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { businessNumbers } = req.body;

  if (!businessNumbers || !Array.isArray(businessNumbers) || businessNumbers.length === 0) {
    return res.status(400).json({ error: "사업자번호 목록이 필요합니다." });
  }

  // 최대 10,000건까지 허용 (100건씩 분할 처리)
  if (businessNumbers.length > 10000) {
    return res.status(400).json({ error: "한 번에 최대 10,000개까지 조회 가능합니다." });
  }

  const apiKey = process.env.NTS_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "서버 API 키가 설정되지 않았습니다. 관리자에게 문의하세요.",
    });
  }

  // 사업자번호 정제 (숫자만 추출, 10자리)
  const cleaned = businessNumbers.map((n) => String(n).replace(/[^0-9]/g, ""));
  const invalid = cleaned.filter((n) => n.length !== 10);
  if (invalid.length > 0) {
    return res.status(400).json({
      error: `올바르지 않은 사업자번호가 있습니다: ${invalid.slice(0, 10).join(", ")}${invalid.length > 10 ? ` 외 ${invalid.length - 10}건` : ""}`,
    });
  }

  try {
    // 100건씩 분할
    const chunks = [];
    for (let i = 0; i < cleaned.length; i += 100) {
      chunks.push(cleaned.slice(i, i + 100));
    }

    // 모든 청크를 병렬로 요청 (단, 동시 최대 5개씩)
    const allResults = [];
    const CONCURRENT_LIMIT = 5;

    for (let i = 0; i < chunks.length; i += CONCURRENT_LIMIT) {
      const batch = chunks.slice(i, i + CONCURRENT_LIMIT);
      const promises = batch.map((chunk) =>
        fetch(
          `https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${encodeURIComponent(apiKey)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({ b_no: chunk }),
          }
        ).then(async (response) => {
          if (!response.ok) {
            const errorText = await response.text();
            console.error("NTS API error:", response.status, errorText);
            throw new Error(`국세청 API 오류 (${response.status})`);
          }
          return response.json();
        })
      );

      const batchResults = await Promise.all(promises);
      for (const data of batchResults) {
        allResults.push(...(data.data || []));
      }
    }

    // 응답 데이터를 사용하기 좋은 형태로 변환
    const results = allResults.map((item) => ({
      businessNumber: formatBizNumber(item.b_no),
      rawNumber: item.b_no,
      status: item.b_stt,
      statusCode: item.b_stt_cd,
      taxType: item.tax_type,
      taxTypeCode: item.tax_type_cd,
      closedAt: item.end_dt || null,
      label: getStatusLabel(item.b_stt_cd),
    }));

    return res.status(200).json({
      success: true,
      count: results.length,
      chunks: chunks.length,
      results,
    });
  } catch (err) {
    console.error("Fetch error:", err);
    return res.status(500).json({
      error: err.message || "서버 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
    });
  }
}

function formatBizNumber(num) {
  const n = String(num).replace(/[^0-9]/g, "");
  if (n.length !== 10) return num;
  return `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}`;
}

function getStatusLabel(code) {
  const map = {
    "01": "계속사업자",
    "02": "휴업자",
    "03": "폐업자",
  };
  return map[code] || "알 수 없음";
}
