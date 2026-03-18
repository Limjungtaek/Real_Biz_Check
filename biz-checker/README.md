# 🏢 사업자 상태 일괄 조회

국세청 공공데이터 API를 이용한 사업자번호 상태 일괄 조회 웹 서비스입니다.  
Next.js + Vercel 기반으로 외부 누구나 접근 가능하게 배포됩니다.

## 주요 기능

- 사업자번호 최대 **100건 동시 조회**
- 계속사업자 / 휴업자 / 폐업자 상태 확인
- 과세유형 및 폐업일 조회
- `.txt` / `.csv` **파일 업로드** 및 **드래그앤드롭** 지원
- 결과 **CSV 다운로드**
- 상태별 필터 및 통계 요약

---

## 🚀 Vercel 배포 방법

### 1단계 — API 키 발급

1. [공공데이터포털](https://www.data.go.kr/data/15081808/openapi.do) 접속 후 로그인
2. **"국세청_사업자등록정보 진위확인 및 상태조회 서비스"** 신청
3. 승인 후 **일반 인증키(Decoding)** 복사

> ⚠️ 발급 후 승인까지 최대 1~2일 소요될 수 있습니다.

---

### 2단계 — GitHub에 올리기

```bash
# 1. GitHub에서 새 레포지토리 생성 (예: biz-checker)

# 2. 로컬에서 초기화 & 업로드
git init
git add .
git commit -m "init: 사업자 상태 일괄 조회 서비스"
git branch -M main
git remote add origin https://github.com/[YOUR_USERNAME]/biz-checker.git
git push -u origin main
```

---

### 3단계 — Vercel 배포

1. [vercel.com](https://vercel.com) 접속 → GitHub 계정으로 로그인
2. **"Add New Project"** → GitHub 레포지토리 선택 (`biz-checker`)
3. Framework Preset: **Next.js** (자동 인식됨)
4. **Environment Variables** 섹션에서:
   - Name: `NTS_API_KEY`
   - Value: 발급받은 서비스키 붙여넣기
5. **"Deploy"** 클릭

배포 완료 후 `https://[your-project].vercel.app` 주소로 접근 가능합니다!

---

### 4단계 — 이후 업데이트

GitHub에 `push`하면 Vercel이 자동으로 재배포합니다.

```bash
git add .
git commit -m "feat: 업데이트 내용"
git push
```

---

## 로컬 개발

```bash
# 패키지 설치
npm install

# 환경변수 설정
cp .env.example .env.local
# .env.local 파일에 NTS_API_KEY 입력

# 개발 서버 실행
npm run dev
# → http://localhost:3000
```

---

## 파일 구조

```
biz-checker/
├── pages/
│   ├── _app.js          # 전역 설정
│   ├── index.js         # 메인 UI
│   └── api/
│       └── check.js     # 국세청 API 프록시 (API 키 보호)
├── styles/
│   └── globals.css      # 전체 스타일
├── .env.example         # 환경변수 예시
├── .gitignore
├── next.config.js
├── package.json
└── README.md
```

---

## 보안 구조

API 키는 **서버사이드(Vercel 환경변수)**에만 저장되며, 브라우저에 절대 노출되지 않습니다.  
`pages/api/check.js`가 프록시 역할을 하여 안전하게 처리합니다.

---

## 입력 형식

사업자번호는 다양한 형식으로 입력 가능합니다:

```
1234567890
123-45-67890
123-45-67890, 234-56-78901
```

줄바꿈 / 쉼표 / 탭 / 세미콜론으로 구분하며, 하이픈은 자동 제거됩니다.

---

## 라이선스

MIT License  
본 서비스는 [국세청 사업자 상태조회 공공데이터 API](https://www.data.go.kr/data/15081808/openapi.do)를 활용합니다.
