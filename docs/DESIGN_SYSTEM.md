# DESIGN_SYSTEM.md — Aerial Survey Manager (SIQMS 실감정사영상 플랫폼)

> 본 문서는 A 시스템(`aerial-survey-manager-main`)의 프론트엔드 코드에서 추출한 디자인 시스템입니다.  
> 다른 개발자가 이 문서만 보고 동일한 시각적 결과물을 재현할 수 있도록 작성되었습니다.

**기술 스택 요약**
- React 18 + Vite, **Tailwind CSS 3.4** (extend 없이 기본 팔레트만 사용)
- **lucide-react** 아이콘, **recharts** 차트
- **Pretendard** 한글 폰트 + 시스템 폰트 폴백
- 다크모드 **미지원** (`dark:` 클래스 사용 0건)

---

## 1. 색상 토큰 (Color Tokens)

Tailwind config에 별도 토큰 정의 없이 Tailwind 기본 팔레트(`slate`, `blue`, `red`, `emerald`, `amber`, `green`)를 그대로 사용. 색 사용 빈도가 매우 비대칭적(slate 압도적 우위)이라는 것이 이 시스템의 정체성.

### 1.1 Neutral / Surface (Slate 계열) — 기본 골격

코드 내 사용 빈도 1·2·3위(`text-slate-500` 114회, `text-slate-400` 96회, `text-slate-700` 58회). **이 시스템 전체 색상의 70% 이상이 slate 계열**.

| 토큰 | Hex | 용도 |
|---|---|---|
| `slate-50` | `#f8fafc` | 페이지 배경, 모달 헤더/푸터 배경, 보조 카드 배경, 비활성 영역, 검색 입력 배경 |
| `slate-100` | `#f1f5f9` | 보조 버튼 배경, 셀렉트 배경, 칩/배지 배경, 빈 상태 배경 |
| `slate-200` | `#e2e8f0` | **모든 보더의 기본값**, 구분선, 호버된 보조 버튼, 진행바 트랙 |
| `slate-300` | `#cbd5e1` | 점선 보더, 비활성 상태 디스크, 스크롤바 thumb |
| `slate-400` | `#94a3b8` | 보조 텍스트(레이블·캡션), 비활성 아이콘, 플레이스홀더 |
| `slate-500` | `#64748b` | **본문 보조 텍스트의 기본값**, 인라인 메타정보 |
| `slate-600` | `#475569` | 약간 강조된 보조 텍스트, 보조 버튼 텍스트 |
| `slate-700` | `#334155` | **준 본문 텍스트(소제목)** |
| `slate-800` | `#1e293b` | **본문 제목/강조 텍스트의 기본값** (h1~h4) |
| `slate-900` | `#0f172a` | 최고 강조(거의 안 씀), 로그인 그라데이션 시작점 |

### 1.2 Primary (Blue 계열) — 단일 액센트

이 시스템의 유일한 **브랜드 액센트**. 액션·선택·진행을 모두 담당.

| 토큰 | Hex | 용도 |
|---|---|---|
| `blue-50` | `#eff6ff` | 선택된 항목 배경(`bg-blue-50`), 정보 박스 배경, 아이콘 컨테이너 배경 |
| `blue-100` | `#dbeafe` | 진행바 트랙(파랑 버전), 정보 박스 보더 |
| `blue-200` | `#bfdbfe` | 선택된 항목 ring/border, 정보 박스 강조 보더 |
| `blue-500` | `#3b82f6` | **차트 기본 색**, 진행바 채움, 활성 도트 |
| `blue-600` | `#2563eb` | **Primary 버튼 배경**, 활성 탭, 강조 텍스트, 활성 아이콘, focus ring |
| `blue-700` | `#1d4ed8` | Primary 버튼 hover 배경, 매우 강조된 텍스트 |
| `blue-800` | `#1e40af` | 정보 박스 내 헤딩, 매우 드물게 강조 |
| `blue-900` | `#1e3a8a` | 로그인 페이지 그라데이션 중간점 |

### 1.3 Semantic — 상태 표현

각 의미당 **3톤(50/100, 500/600, 700)** 으로만 사용. 동일 패턴: 연한 배경 + 보더 + 진한 텍스트.

**Success — Emerald**
- `emerald-50` `#ecfdf5` (배경) / `emerald-100` `#d1fae5` (보더·강조 배경) / `emerald-500` `#10b981` (차트, 도넛 완료) / `emerald-600` `#059669` (텍스트) / `emerald-700` `#047857` (강조 텍스트)
- 용도: 완료 상태 배지, 성공 메시지, "결과" 펄스 배지(`bg-emerald-500 text-white animate-pulse`), EO 데이터 강조
- 차트 컬러로는 **green이 아닌 emerald-500**을 사용

**Danger — Red**
- `red-50` `#fef2f2` / `red-100` `#fee2e2` / `red-200` `#fecaca` (보더) / `red-500` `#ef4444` / `red-600` `#dc2626` / `red-700` `#b91c1c`
- 용도: 오류 상태, 삭제 버튼, 경고 박스, 에러 메시지
- 패턴: `bg-red-50 text-red-600 border border-red-200` (조용한 경고), `bg-red-600 text-white` (확정 삭제 버튼)

**Warning — Amber**
- `amber-50` `#fffbeb` / `amber-100` `#fef3c7` / `amber-200` `#fde68a` / `amber-500` `#f59e0b` / `amber-600` `#d97706` / `amber-700` `#b45309` / `amber-800` `#92400e`
- 용도: 업로드 진행, 예약 상태, 주의 안내, "원본 사진 삭제됨" 같은 회수 불가 안내
- 차트 warning 컬러: `#f59e0b`

### 1.4 차트 전용 팔레트

`src/components/Dashboard/Charts.jsx` 정의:
```javascript
const COLORS = {
    primary: '#3b82f6',  // blue-500
    success: '#10b981',  // emerald-500
    warning: '#f59e0b',  // amber-500
    danger:  '#ef4444',  // red-500
    slate:   '#64748b',  // slate-500
    blue:  ['#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe'], // 단색 그라데이션
    multi: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'] // 다색
};
```

### 1.5 Overlay / Glassmorphism

- 모달 오버레이: `bg-black/60 backdrop-blur-sm` (자주 사용)
- 변형: `bg-black/50`, `bg-black/40` (더 가벼운 오버레이)
- 로그인 페이지 글래스: `bg-white/10 backdrop-blur-xl border border-white/20`

---

## 2. 타이포그래피 (Typography)

### 2.1 폰트 패밀리

`src/styles.css`:
```css
body {
  font-family: 'Pretendard', -apple-system, BlinkMacSystemFont, system-ui, Roboto, sans-serif;
}
```

Pretendard는 **별도 import 없음** — 시스템 또는 외부 CDN을 통한 로드를 가정.  
한글이 주 언어이므로 영문 fallback은 시스템 산세리프.

### 2.2 폰트 크기 스케일 (사용 빈도 순)

| 클래스 | px | 사용 빈도 | 용도 |
|---|---|---|---|
| `text-sm` | 14px | **173회 (압도적 1위)** | **본문 기본**, 버튼 라벨, 입력 필드, 메뉴 |
| `text-xs` | 12px | **102회 (2위)** | 메타 정보, 캡션, 보조 라벨, 상태 배지 |
| `text-lg` | 18px | 17회 | 모달/패널 헤더 제목, 강조 |
| `text-[10px]` | 10px | 8회 | 매우 작은 배지, 핀트 정보, 진행 단계 |
| `text-3xl` | 30px | 5회 | 큰 수치 강조 (KPI, 처리율 %) |
| `text-2xl` | 24px | 5회 | 카드 내 KPI 숫자, 로그인 제목 |
| `text-xl` | 20px | 5회 | 모달 내 단계 제목 |
| `text-base` | 16px | 2회 | 거의 안 씀 (본문은 14px이 기본) |
| `text-[9px]` | 9px | 1회 | 진행 단계 매우 작은 % 표시 |

**핵심 패턴**: 14px가 본문, 12px가 보조 텍스트. 16px는 거의 사용하지 않음. 모바일·태블릿 대응 텍스트 사이즈는 별도 정의 안 됨.

### 2.3 폰트 두께 (Weight)

| 클래스 | weight | 사용 빈도 | 용도 |
|---|---|---|---|
| `font-bold` | 700 | **177회 (압도적 1위)** | 거의 모든 강조: 버튼, 제목, KPI, 라벨 |
| `font-medium` | 500 | 69회 | 약한 강조, 메뉴 텍스트, 일부 라벨 |
| `font-semibold` | 600 | 17회 | 거의 안 씀 |
| `font-normal` | 400 | 5회 | 본문 기본(클래스 명시 없으면 normal) |

**핵심 패턴**: **font-bold가 시스템의 시각적 시그니처**. 한글 환경에서 굵은 폰트로 위계를 잡는 한국식 디자인 관습이 강하게 반영됨. 600은 거의 안 쓰고 400 ↔ 700의 강한 대비.

### 2.4 텍스트 위계 패턴

| 위계 | 패턴 | 예시 |
|---|---|---|
| H1 (페이지 메인 타이틀) | `text-3xl font-bold text-slate-800 leading-tight` | 인스펙터 패널 프로젝트 타이틀 |
| H2 (모달/섹션 큰 헤더) | `text-xl font-bold text-slate-800` | UploadWizard 단계 제목 |
| H3 (모달 헤더, 카드 헤더) | `font-bold text-lg text-slate-800` 또는 `text-sm font-bold text-slate-700` | 모달 헤더, 통계 카드 헤더 |
| H4 (서브 섹션) | `text-xs font-bold text-slate-400 uppercase tracking-wider` | 인스펙터 패널 섹션 헤더 (대문자 + 트래킹) |
| 본문 | `text-sm text-slate-700` 또는 `text-sm` (기본) | 일반 텍스트 |
| 보조 / 메타 | `text-xs text-slate-500` 또는 `text-xs text-slate-400` | 캡션, 부가 설명 |
| 라벨 (입력 위) | `text-xs font-bold text-slate-500 block` | 폼 라벨 |
| KPI 숫자 | `text-2xl font-bold text-slate-800` 또는 `text-3xl font-bold text-blue-700` | 통계 카드 |
| KPI 단위 | `text-sm text-slate-500 font-medium` | "km²", "건" 등 |

**`uppercase tracking-wider` 패턴**: 섹션 헤더에서 한정적으로 사용. 영문/혼용 라벨에 분위기 부여.

### 2.5 줄간격 (line-height)

대부분 Tailwind 기본값. `leading-tight`(1.25)는 큰 제목에서, `leading-relaxed`(1.625)는 본문 긴 문단(에러 메시지)에서 사용.

---

## 3. 간격 시스템 (Spacing)

Tailwind 기본 spacing scale 사용 (1단위 = 0.25rem = 4px). 빈도 순:

| 클래스 | px | 빈도 | 주 용도 |
|---|---|---|---|
| `gap-2` | 8 | **84회 (1위)** | 아이콘+텍스트 표준 간격, flex 그룹 |
| `p-3` | 12 | 45 | 작은 카드/박스 안쪽 |
| `px-3` | 12 | 37 | 칩, 작은 버튼 좌우 |
| `p-2` | 8 | 36 | 매우 작은 박스 |
| `gap-3` | 12 | 35 | 약간 넓은 그룹 간격 |
| `py-2` | 8 | 33 | 입력 필드, 일반 버튼 상하 |
| `gap-1` `gap-1.5` | 4·6 | 32+18 | 매우 좁은 그룹(아이콘 옆) |
| `py-0.5` | 2 | 20 | **상태 배지 상하 (패치된 작은 칩)** |
| `py-3` | 12 | 19 | 큰 버튼 상하 |
| `p-5` | 20 | 17 | 카드/패널 안쪽 표준 |
| `p-1` `p-1.5` | 4·6 | 17+16 | 아이콘 버튼 패딩 |
| `p-6` `px-6` | 24 | 13+13 | 모달 내부 표준 |

### 3.1 컴포넌트별 표준 간격

- **카드 안쪽 패딩**: `p-5` (StatsCard) 또는 `p-4` (DashboardStatsCard 압축형)
- **모달 본문 패딩**: `p-6` (양옆 24px) — 모든 모달에서 일관
- **입력 필드 내부**: `px-3 py-2` 또는 `p-2.5`
- **버튼 일반**: `px-4 py-2`, **버튼 큰 것**: `px-6 py-2.5` 또는 `py-3`
- **아이콘 버튼**: `p-1` ~ `p-1.5`
- **상태 배지**: `px-1.5 py-0.5` (매우 타이트한 칩)
- **섹션 사이**: `space-y-4` ~ `space-y-6`
- **그리드 간격**: `gap-4` (카드 사이), `gap-3` (입력 필드 사이)

---

## 4. 레이아웃 (Layout)

### 4.1 앱 루트 구조

```jsx
<div className="flex flex-col h-screen w-full bg-slate-100 overflow-hidden font-sans">
  <Header />                          {/* 고정 높이 56px */}
  <div className="flex flex-1 overflow-hidden relative">
    <Sidebar />                        {/* 폭 가변, 기본 800px */}
    <Main />                           {/* flex-1 */}
  </div>
</div>
```

전체 페이지: `h-screen overflow-hidden` — 페이지 전체 스크롤이 아니라 **각 영역이 개별 스크롤**되는 데스크톱 앱 레이아웃.

### 4.2 핵심 치수

| 영역 | 치수 |
|---|---|
| **헤더 높이** | `h-14` = **56px** (모든 화면 고정) |
| **모달 헤더 높이** | `h-14` 또는 `h-16` (64px, 더 큰 모달) |
| **모달 푸터 높이** | `h-16` = 64px |
| **사이드바 폭** | 가변 리사이즈 (기본 **800px** — 매우 넓음) |
| **버튼 높이 (관리자 폼 등)** | `h-10` = 40px |
| **헤더 로고 영역** | `w-[64px] h-[64px]` |
| **로그인 페이지 폼 폭** | `max-w-md` = 28rem |
| **AdminPanel 모달 폭** | `max-w-5xl` = 64rem |
| **ExportDialog 모달 폭** | `w-[500px]` (고정) |
| **UploadWizard 모달 폭** | `w-[900px] max-h-[95vh]` |
| **모달 max-height** | 일반 `max-h-[88vh]`, 큰 모달 `max-h-[95vh]` |

### 4.3 헤더 표준

```jsx
<header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 z-20 shadow-sm shrink-0">
  <div className="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity">
    <img className="w-[64px] h-[64px] object-contain" />
    <h1 className="font-bold text-lg text-slate-800 tracking-tight">
      메인 타이틀 <span className="font-normal text-slate-500">| 서브 타이틀</span>
    </h1>
  </div>
  {/* 오른쪽: 사용자 영역, 보더 좌측에 pl-4 border-l border-slate-200 */}
</header>
```

**시그니처**: 메인 타이틀(`font-bold text-slate-800`) + 파이프 + 서브타이틀(`font-normal text-slate-500`) — 한국 정부/공공 시스템에서 흔한 "기관명 | 시스템명" 패턴.

### 4.4 사이드바 표준

```jsx
<aside className="bg-white border-r border-slate-200 flex flex-col h-full z-10 shadow-sm shrink-0">
  <div className="p-4 pb-2 flex gap-2">{/* 상단 액션 (Primary 버튼) */}</div>
  <div className="p-4 pt-2 border-b border-slate-200 space-y-3">{/* 검색·필터 */}</div>
  <div className="px-4 py-2 border-b border-slate-100 bg-slate-50 text-xs font-bold text-slate-500">
    {/* 작은 회색 라벨 행 (전체 선택 등) */}
  </div>
  <div className="flex-1 overflow-y-auto custom-scrollbar">
    <div className="p-2 space-y-1">{/* 리스트 */}</div>
  </div>
  {/* 하단 컨텍스트 액션: bg-slate-50 border-t border-slate-200 */}
</aside>
```

### 4.5 반응형 / Breakpoint

- Tailwind 기본 breakpoint 사용: `md:` (768px), `lg:` (1024px) 정도만 등장
- 빈도가 낮음 — 이 시스템은 **데스크톱 우선** 설계, 모바일 대응은 부분적
- 예: `grid-cols-2 lg:grid-cols-4` (StatsCardsGrid), `hidden md:block` (헤더 사용자 이름)

### 4.6 z-index 체계

| 값 | 용도 |
|---|---|
| `z-0` | Leaflet 지도 컨테이너 (별도 stacking context) |
| `z-10` | 사이드바 |
| `z-20` | 헤더 |
| `z-50` | 드롭다운 메뉴 |
| `z-[1000]` | **모달 (모든 다이얼로그)** |
| `z-[1001]` | Leaflet popup pane |

---

## 5. 컴포넌트 패턴 (Component Patterns)

### 5.1 Button

이 시스템에는 5개의 명확한 버튼 variant가 있음.

#### Primary (파란 버튼)
```jsx
<button className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-sm shadow-md transition-all active:scale-95">
  내보내기
</button>
```
- 배경: `bg-blue-600 hover:bg-blue-700`
- 텍스트: `text-white font-bold`
- 모서리: `rounded-lg` (8px)
- 그림자: `shadow-md`
- 인터랙션: `active:scale-95` 또는 `transition-colors`
- 큰 변형: `py-3` 또는 `py-4`, `rounded-xl`, `shadow-lg shadow-blue-200` (강조 그림자)

#### Strong / Dark (진한 회색 버튼)
```jsx
<button className="px-4 py-2.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-sm font-bold shadow-md transition-colors">
```
- "강력한 액션"용 (벌크 내보내기, 최종 저장)
- Primary와 위계 구분이 필요할 때

#### Secondary (회색 버튼)
```jsx
<button className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors text-xs font-medium">
```
- 텍스트 톤이 700, 배경은 100, hover에서 200
- `rounded` 또는 `rounded-md`

#### Ghost / Text (배경 없음)
```jsx
<button className="px-4 py-2 text-slate-500 font-bold hover:bg-slate-200 rounded-lg text-sm">취소</button>
```
- 모달 "취소" 버튼의 표준 — 배경 없고 hover에서만 회색.

#### Danger (빨간 버튼)
- **두 가지 variant**:
  - 조용한 경고 (삭제 안내): `bg-red-50 text-red-600 hover:bg-red-100 border border-red-200 rounded-lg`
  - 확정 삭제: `bg-red-500 hover:bg-red-600 text-white rounded-lg font-bold` 또는 `bg-red-600 hover:bg-red-700`

#### Icon-only Button
```jsx
<button className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded">
  <Edit2 size={14} />
</button>
```
- `p-1` ~ `p-1.5` 패딩
- 평상시 회색 아이콘, hover에서 색 + 배경 동시 변화
- 삭제는 `hover:text-red-500 hover:bg-red-50`

#### 비활성 상태 공통
- `disabled:opacity-40 disabled:cursor-not-allowed` 또는 `disabled:bg-slate-300 disabled:cursor-wait`

---

### 5.2 Card

```jsx
<div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
```

**카드의 표준 공식 (외워둘 것)**:
- 배경: `bg-white`
- 모서리: `rounded-xl` (12px) — 카드는 항상 xl
- 패딩: `p-5` (20px) 또는 `p-4`
- 그림자: `shadow-sm` (매우 옅음)
- 보더: `border border-slate-100` (거의 안 보이는 보더로 깊이 추가)
- hover: `hover:shadow-md transition-shadow`

#### KPI 카드 (StatsCard)
```jsx
<div className="bg-white rounded-xl p-5 shadow-sm border border-slate-100 hover:shadow-md transition-shadow">
  <div className="flex items-start justify-between">
    <div className="flex items-center gap-3">
      <div className="p-2.5 bg-blue-50 rounded-lg text-blue-600">{icon}</div>
      <div>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-bold text-slate-800">{value}</span>
          <span className="text-sm text-slate-500 font-medium">{unit}</span>
        </div>
        <p className="text-sm text-slate-500 mt-0.5">{label}</p>
      </div>
    </div>
    {/* trend 배지 */}
  </div>
</div>
```

**아이콘 컨테이너 패턴**: `p-2.5 bg-blue-50 rounded-lg text-blue-600` — 색상은 의미별로 변형(`bg-emerald-50 text-emerald-600`, `bg-amber-50 text-amber-600` 등).

#### 강조 카드 (인스펙터 패널의 KPI)
```jsx
<div className="bg-blue-50 border border-blue-100 rounded-xl p-5 text-center">
  <p className="text-xs text-blue-500 font-bold uppercase tracking-wider mb-1">면적</p>
  <p className="text-3xl font-bold text-blue-700">12.345</p>
  <p className="text-sm text-blue-400 mt-0.5">km²</p>
</div>
```

---

### 5.3 Input / Select / Textarea

#### 표준 입력
```jsx
<input className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-md text-sm" />
```
- 배경: `bg-slate-50` (약하게 회색) 또는 `bg-white`
- 보더: `border border-slate-200`
- 모서리: `rounded-md` (6px) — **입력은 md, 버튼은 lg**
- 텍스트: `text-sm`
- 패딩: `px-3 py-2` 또는 `p-2.5`

#### 아이콘 입력 (왼쪽 아이콘)
```jsx
<div className="relative">
  <Search className="absolute left-3 top-2.5 text-slate-400" size={16} />
  <input className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-md text-sm" />
</div>
```

#### Focus 상태
```jsx
className="focus:ring-2 focus:ring-blue-500 outline-none transition-all"
```
- 표준: `focus:ring-2 focus:ring-blue-500` + `outline-none`
- 변형: `focus:border-blue-500` (보더만 변화)
- 일부 입력은 focus 처리가 명시 안 돼 있음 — **추가 시 위 패턴 사용**

#### Select
- 입력과 동일한 스타일 (`rounded-md` 또는 `rounded-lg`)
- 큰 셀렉트(고정 높이): `h-10 border border-slate-200 rounded-md px-3 text-sm`

#### 라벨 (입력 위)
```jsx
<label className="text-xs font-bold text-slate-500 block">포맷 (Format)</label>
```
- **`text-xs font-bold text-slate-500`이 표준 라벨**
- 한영 병기 패턴 자주 등장: "포맷 (Format)", "좌표계 (CRS)"

---

### 5.4 Modal / Dialog

```jsx
<div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
  <div className="bg-white rounded-xl shadow-2xl w-[500px] overflow-hidden">
    {/* Header */}
    <div className="h-14 border-b border-slate-200 bg-slate-50 flex items-center justify-between px-6">
      <h3 className="font-bold text-slate-800 flex items-center gap-2">
        <Download size={20} className="text-blue-600" />
        제목
      </h3>
      <button onClick={onClose}><X size={20} className="text-slate-400 hover:text-slate-600" /></button>
    </div>
    {/* Body */}
    <div className="p-6 space-y-6">…</div>
    {/* Footer */}
    <div className="h-16 border-t border-slate-200 bg-slate-50 px-6 flex items-center justify-end gap-3">
      <button>취소</button>
      <button>확인</button>
    </div>
  </div>
</div>
```

**모달 표준 공식 (전 시스템 일관)**:
- 오버레이: `fixed inset-0 z-[1000] bg-black/60 backdrop-blur-sm`
- 진입 애니메이션: `animate-in fade-in duration-200`
- 컨테이너: `bg-white rounded-xl shadow-2xl overflow-hidden`
- 폭: 컨텐츠 따라 `w-[500px]` ~ `w-[900px]` ~ `max-w-5xl`
- 헤더: `h-14 border-b border-slate-200 bg-slate-50 px-6` — 회색 배경의 구분된 헤더
- 헤더 제목: `font-bold text-slate-800` + 좌측 색상 아이콘
- 본문: `p-6 space-y-6` (또는 `space-y-5`)
- 푸터: `h-16 border-t border-slate-200 bg-slate-50 px-6 flex items-center justify-end gap-3`
- 푸터 버튼 정렬: 항상 **오른쪽 정렬** (취소 → 확인 순서)

ESC 키로 닫는 게 표준 (`useEffect`로 keydown 등록).

---

### 5.5 Tabs

```jsx
<div className="px-6 py-3 border-b border-slate-200 flex gap-2 flex-wrap">
  <button className={`px-3 py-2 rounded-md text-sm font-medium ${
    isActive ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-700'
  }`}>
    사용자
  </button>
</div>
```

**탭 패턴**: 활성 = 파란 배경 + 흰 글씨, 비활성 = 회색 배경 + 진한 텍스트. 밑줄 탭 스타일은 사용 안 함.  
비활성화 탭: `opacity-50 cursor-not-allowed`

---

### 5.6 Status Badge / Pill

```jsx
<span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium border bg-emerald-50 text-emerald-600 border-emerald-100">
  완료
</span>
```

**시그니처 작은 칩**: 매우 작음(`text-[10px]`), 둥글둥글(`rounded-full`), 의미별 배경+테두리+텍스트 3색 일치.

| 상태 | 클래스 |
|---|---|
| 완료 (success) | `bg-emerald-50 text-emerald-600 border-emerald-100` |
| 진행중 (info) | `bg-blue-50 text-blue-600 border-blue-100` |
| 오류 (danger) | `bg-red-50 text-red-600 border-red-100` |
| 대기 (neutral) | `bg-slate-50 text-slate-500 border-slate-100` |
| 업로드 중 (warning) | `bg-amber-50 text-amber-600 border-amber-200` |
| 활성 (관리 패널) | `bg-emerald-50 text-emerald-600 text-[11px] px-2 py-0.5 rounded` |

펄스 강조 배지: `bg-emerald-500 text-white animate-pulse` (결과 보기 같은 어텐션 유도).

---

### 5.7 Table / List Row

이 시스템에는 전통적 `<table>`이 거의 없고, **Grid 기반 의사 테이블**을 사용:

```jsx
<div className="border rounded-xl overflow-hidden">
  <div className="max-h-72 overflow-y-auto">
    {items.map(item => (
      <div className="grid grid-cols-12 gap-2 items-center px-3 py-2 border-b text-sm last:border-b-0">
        <div className="col-span-3 truncate">{item.email}</div>
        <div className="col-span-3 truncate">{item.name}</div>
        ...
        <div className="col-span-2 flex gap-2 justify-end">
          <button className="px-2 py-1 bg-slate-100 rounded text-slate-700">수정</button>
        </div>
      </div>
    ))}
  </div>
</div>
```

- 컨테이너: `border rounded-xl overflow-hidden`
- 행: `grid grid-cols-12 gap-2 items-center px-3 py-2 border-b last:border-b-0`
- 행 내 액션 버튼: `px-2 py-1 bg-slate-100 rounded text-slate-700` (매우 작은 버튼)
- 빈 상태: `<div className="p-3 text-sm text-slate-500">데이터가 없습니다.</div>`

---

### 5.8 Progress Bar

```jsx
<div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
  <div className="h-full bg-blue-500 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
</div>
```

- 두 가지 굵기: `h-1.5` (얇음, 카드 내부), `h-2` (모달 진행바)
- 트랙: `bg-slate-200` 또는 `bg-blue-100` (파란 영역에 들어갈 때) 또는 `bg-slate-100`
- 채움: `bg-blue-500` 또는 `bg-blue-600`
- transition: `transition-all duration-500 ease-out`

---

### 5.9 Empty State

```jsx
<div className="text-center text-slate-400 py-8 text-sm">프로젝트가 없습니다</div>
```

- 매우 미니멀: 회색 텍스트, 중앙 정렬, 아이콘 없는 경우 많음
- 점선 보더 박스 변형:
```jsx
<div className="flex flex-col items-center justify-center min-h-[160px] border-2 border-dashed border-slate-300 rounded-xl text-slate-400 gap-4 p-6 bg-white shadow-inner">
```

---

### 5.10 Notification / Banner (인라인)

```jsx
{/* 정보 박스 */}
<div className="bg-blue-50 p-4 rounded-lg border border-blue-100 flex justify-between items-center">

{/* 경고 박스 */}
<div className="bg-red-50 p-3 rounded-lg border border-red-200 flex gap-2">
  <AlertTriangle size={16} className="text-red-500 mt-0.5 flex-shrink-0" />
  <p className="text-xs text-red-600">메시지</p>
</div>

{/* 성공 박스 */}
<div className="bg-green-50 p-4 rounded-lg border border-green-200 text-center">
```

**공통 공식**: `bg-{color}-50 border border-{color}-200(또는 100) rounded-lg p-3~4 text-{color}-600(또는 700)`. 좌측 아이콘은 `flex-shrink-0` + `mt-0.5`.

---

## 6. 인터랙션 (Interaction)

### 6.1 Transition

| 클래스 | 빈도 | 용도 |
|---|---|---|
| `transition-colors` | **55회 (1위)** | 버튼·아이콘 색 변화의 기본 |
| `transition-all` | 30회 | 모서리·그림자 등 복합 변화 |
| `transition-opacity` | 4회 | 호버로 나타나는 요소 |
| `transition-shadow` | 1회 | 카드 hover |

기본 duration은 명시 안 함 (Tailwind 기본 150ms). 커스텀:
- `duration-200` — 모달 페이드인
- `duration-300` — 패널 슬라이드
- `duration-500` — 진행바 채움

Easing: `ease-out`이 기본, 커스텀 `cubic-bezier(0.4, 0, 0.2, 1)` (smooth-transition 클래스).

### 6.2 Hover 패턴

- **버튼**: 색만 한 단계 진하게 (`bg-blue-600 → hover:bg-blue-700`)
- **카드**: `hover:shadow-md` (그림자 강화)
- **아이콘 버튼**: 텍스트 색 + 배경색 동시 (`hover:text-blue-600 hover:bg-blue-50`)
- **리스트 행**: `hover:bg-slate-50` (선택 안 됐을 때)
- **드러나는 액션**: `opacity-0 group-hover:opacity-100 transition-all` — 행 호버 시 수정·삭제 아이콘 노출

### 6.3 Focus 상태

표준: `focus:ring-2 focus:ring-blue-500 outline-none`. 일관성은 다소 약함(일부 입력엔 명시 없음).

### 6.4 Active 상태

`active:scale-95` — Primary 버튼에서 자주 사용 (탭/클릭의 "눌림" 피드백).

### 6.5 Animation

`src/styles.css`와 App.jsx 인라인 정의:

```css
@keyframes slideInFromLeft  { from { transform: translateX(-20px); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
@keyframes slideInFromRight { from { transform: translateX(100%); opacity: 0 } to { transform: translateX(0); opacity: 1 } }
@keyframes fadeIn           { from { opacity: 0 } to { opacity: 1 } }
```

- `.animate-fade-in { animation: fadeIn 0.3s ease-out forwards; }`
- `.hover-lift:hover { transform: translateY(-2px); }` — `cubic-bezier(0.34, 1.56, 0.64, 1)` 살짝 튀는 easing
- `animate-in fade-in duration-200` (Tailwind animate plugin 패턴) — 모달 진입
- `animate-in slide-in-from-bottom duration-200` — 사이드바 하단 액션 영역
- `animate-pulse` — 어텐션 배지

### 6.6 Custom Scrollbar

```css
.custom-scrollbar::-webkit-scrollbar { width: 6px; height: 6px; }
.custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
.custom-scrollbar::-webkit-scrollbar-thumb { background-color: #cbd5e1; border-radius: 3px; }
.custom-scrollbar::-webkit-scrollbar-thumb:hover { background-color: #94a3b8; }
```

- 가는 세로 스크롤바 (6px, slate-300, hover에서 slate-400)
- 사용 위치: 사이드바, 모달 본문 등 — 스크롤 가능한 영역에는 거의 항상 적용

---

## 7. 아이콘 시스템 (Icons)

### 7.1 라이브러리

**[lucide-react](https://lucide.dev/) v0.344.0** — 단일 라이브러리만 사용 (혼용 없음).

```jsx
import { Bell, User, LogOut, Settings, ... } from 'lucide-react';
```

### 7.2 아이콘 크기 규칙

`size` prop으로만 제어 (Tailwind `w-4 h-4` 식 안 씀). 빈도:

| size | 빈도 | 용도 |
|---|---|---|
| **14** | 36회 (1위) | **인라인 텍스트 옆**, 버튼 내 작은 아이콘, 컨텍스트 메뉴 |
| **16** | 32회 | 입력 prefix, 일반 버튼, 인라인 메타 정보 |
| **18** | 29회 | 약간 큰 버튼, 카드 헤더 |
| **20** | 15회 | 모달 헤더, 큰 버튼 |
| **12** | 15회 | 매우 작은 칩 안 |
| **24** | 7회 | 강조 큰 아이콘 (UploadCloud 같은 메인 액션) |
| **48** | 7회 | 빈 상태/단계 페이지의 거대 아이콘 |
| **10** | 6회 | 핀 사이즈 배지 안 |

**핵심 원칙**: 14가 본문 텍스트(14px)와 시각적으로 같은 크기. 텍스트 옆 아이콘은 텍스트와 동일하거나 약간 큰 크기로.

### 7.3 아이콘 + 텍스트 조합

```jsx
<button className="flex items-center gap-2">
  <Download size={16} /> 내보내기
</button>
```

- `flex items-center gap-2` (또는 `gap-1.5` 좁게)
- 아이콘이 항상 텍스트 **앞**

### 7.4 아이콘 색

- 일반: 부모 텍스트 색을 상속 (CSS `currentColor`)
- 명시: `className="text-blue-600"` 식으로 부여
- 비활성: `text-slate-400`

---

## 8. 다크모드 (Dark Mode)

**미지원**. `dark:` 클래스 사용 0건. 시스템 테마 감지·토글 UI 없음.

라이트 테마 단일이지만, 로그인 페이지처럼 **국지적 다크 영역**이 있음:

```jsx
<div className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 ...">
  <div className="bg-white/10 backdrop-blur-xl rounded-2xl ... border border-white/20">
```

이는 테마가 아닌 **연출 목적의 일회성 다크 배경** — 본 앱 전체 다크모드와는 무관.

---

## 9. 디자인 시스템의 핵심 정체성

이 시스템은 **"정부·공공 SaaS의 한국형 정통 라이트 테마"** 다. 압도적 slate 회색조 위에 단일 blue-600 액센트가 모든 액션·선택·진행을 책임지고, 의미 표현은 emerald·red·amber 3색이 좁게 분담한다. 시각 위계는 `font-bold(177회)`와 14px↔12px 사이즈 대비로 만들어내며, 한글에 최적화된 굵은 강조와 절제된 색 사용으로 정보 밀도가 높은 화면에서도 가독성을 유지한다. 카드는 `rounded-xl + shadow-sm + border-slate-100`이라는 매우 옅은 깊이감으로 통일되어 있고, 모달은 모두 `bg-black/60 backdrop-blur-sm` 오버레이 + 회색 헤더·푸터 + 흰 본문이라는 한 가지 공식만 따른다. 데스크톱 워크스테이션을 가정한 `h-screen overflow-hidden` 레이아웃에서 헤더 56px·사이드바 800px·z-[1000] 모달이라는 고정된 골격 위에 조밀한 폼·테이블·KPI 카드가 얹히는 구조이며, 인터랙션은 `transition-colors`와 `active:scale-95` 정도로 절제되어 있어 화려함보다는 신뢰감과 업무 효율을 우선한다.
