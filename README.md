# 스피또 모니터링 시스템

## 프로젝트 개요
- **이름**: 스피또 모니터링 시스템 (Speetto Monitor)
- **목표**: 한국 동행복권 스피또 2000, 스피또 1000의 출고율이 100%에 도달하고 1등 당첨금이 남아있을 때 자동으로 SMS 알림을 발송
- **핵심 기능**: 
  - 실시간 스피또 출고율 및 잔여 당첨금 모니터링
  - 조건 만족 시 자동 SMS 알림 발송 
  - 웹 대시보드를 통한 현황 확인
  - 10분마다 자동 체크 (Cloudflare Cron Trigger)

## URL
- **개발 서버**: https://3000-ixfcl440akixjdhzj9jp7-6532622b.e2b.dev
- **GitHub**: (GitHub 연동 후 업데이트 예정)
- **프로덕션**: (Cloudflare Pages 배포 후 업데이트 예정)

## 데이터 아키텍처
- **데이터 모델**:
  - `games`: 스피또 게임 정보 (이름, 회차)
  - `monitoring_data`: 모니터링 데이터 (출고율, 잔여 당첨금)
  - `notification_settings`: 사용자 알림 설정 (전화번호, 모니터링 게임)
  - `notification_logs`: 알림 발송 로그
- **스토리지 서비스**: Cloudflare D1 SQLite 데이터베이스
- **데이터 흐름**: 
  1. 동행복권 사이트에서 HTML 크롤링
  2. 출고율/잔여 당첨금 파싱 및 데이터베이스 저장
  3. 조건 체크 (출고율 100% AND 1등 잔여 > 0)
  4. 조건 만족 시 SOLAPI를 통해 SMS 발송

## 사용자 가이드

### 1. 자동 모니터링
- **자동 체크**: 매 1시간마다 동행복권 사이트에서 스피또 현황 확인
- **수신번호**: 고정 번호 `01067790104`로 SMS 발송
- **알림 조건**: 출고율 100% + 1등 잔존 시

### 2. 현재 상태 확인
- "현재 상태" 섹션에서 실시간 출고율 및 잔여 당첨금 확인
- "지금 확인" 버튼으로 수동 체크 가능
- 🚨 알림 조건 만족 시 빨간색으로 표시

### 3. 알림 로그 확인
- "최근 알림 로그" 섹션에서 발송된 SMS 내역 확인
- 발송 시간, 게임 정보, 발송 상태 등 표시

## 기술 스택
- **백엔드**: Hono Framework + TypeScript
- **프론트엔드**: Vanilla JavaScript + TailwindCSS
- **데이터베이스**: Cloudflare D1 (SQLite)
- **SMS 서비스**: SOLAPI (솔라피)
- **배포**: Cloudflare Pages + Workers
- **스케줄링**: Cloudflare Cron Triggers (10분 간격)

## 구현된 기능
✅ **완료된 기능**:
- [x] 웹 대시보드 UI/UX
- [x] 스피또 데이터 크롤링 시스템
- [x] 출고율 및 잔여 당첨금 파싱
- [x] 조건 체크 로직 (출고율 100% + 1등 잔여 > 0)
- [x] SOLAPI SMS 발송 서비스 연동
- [x] 알림 설정 관리 (전화번호, 게임 선택)
- [x] 알림 발송 로그 저장 및 조회
- [x] 중복 알림 방지 (일일 기준)
- [x] 자동 스케줄링 (Cron Trigger)
- [x] D1 데이터베이스 구조 및 마이그레이션
- [x] 수동 체크 기능
- [x] 실시간 상태 모니터링

⏳ **진행 예정**:
- [ ] Cloudflare Pages 프로덕션 배포
- [ ] SOLAPI API 키 설정 (환경변수)
- [ ] GitHub 연동 및 CI/CD 구축
- [ ] 발신번호 등록 (SOLAPI)
- [ ] 알림 설정 수정/삭제 기능
- [ ] 모바일 반응형 최적화
- [ ] 에러 처리 및 로깅 개선

## API 엔드포인트
- `GET /`: 메인 대시보드
- `GET /api/status`: 현재 스피또 상태 조회
- `POST /api/check-now`: 수동 체크 실행
- `GET /api/notification-logs`: 알림 로그 조회
- `GET /api/cron-trigger`: Cron 트리거 수동 테스트

### 📱 알림 메시지 예시
```
🚨 스피또 알림 🚨

스피또1000 99회
📊 출고율: 100%
🎰 1등 잔여: 2매

출고율 100%에 1등이 남아있습니다!
지금이 구매 기회입니다! 🍀

시간: 2025-09-17 19:30:15
```

### 🔧 현재 테스트 상태
- ✅ **시스템 로직**: 정상 동작 (알림 조건 만족 감지)
- ✅ **데이터베이스**: 정상 저장 및 조회  
- ✅ **웹 대시보드**: 실시간 현황 표시
- ⚠️ **SMS 발송**: SOLAPI API 키 설정 필요
- ✅ **자동 스케줄링**: 1시간마다 Cron 실행 설정

## 배포 상태
- **로컬 개발**: ✅ 실행 중 (PM2)
- **Cloudflare Pages**: ⏳ 프로덕션 배포 대기  
- **SMS 연동**: ⚠️ SOLAPI API 키 설정 필요
- **자동 스케줄링**: ✅ 구현 완료 (1시간 간격)

## 설치 및 실행

### 로컬 개발 환경
```bash
# 프로젝트 클론
git clone <repository-url>
cd webapp

# 의존성 설치
npm install

# 빌드
npm run build

# 개발 서버 시작 (PM2)
pm2 start ecosystem.config.cjs

# 또는 직접 실행
npm run dev:sandbox
```

### 환경 변수 설정
```bash
# .dev.vars 파일 생성
SOLAPI_API_KEY=your_solapi_api_key
SOLAPI_SECRET_KEY=your_solapi_secret_key
```

### 데이터베이스 설정
```bash
# D1 데이터베이스 생성 (Cloudflare 계정 필요)
npx wrangler d1 create speetto-monitor-production

# 로컬 마이그레이션
npx wrangler d1 migrations apply speetto-monitor-production --local
```

## 프로덕션 배포를 위한 다음 단계

### 필수 설정
1. **SOLAPI 계정 설정**: 
   - SOLAPI 가입 및 API 키 발급
   - 발신번호 `01067790104` 등록 및 승인
   - 환경변수 설정: `SOLAPI_API_KEY`, `SOLAPI_SECRET_KEY`

2. **Cloudflare 배포**:
   ```bash
   # Cloudflare API 키 설정
   setup_cloudflare_api_key
   
   # D1 데이터베이스 생성
   npx wrangler d1 create speetto-monitor-production
   
   # 프로덕션 배포
   npm run deploy:prod
   ```

### 시스템 특징
- **완전 자동화**: 사용자 개입 없이 자동 모니터링 및 알림
- **조건 만족 시에만 발송**: 불필요한 알림 최소화  
- **중복 방지**: 동일 게임/회차/일자에 대해 최대 1회 발송
- **실시간 모니터링**: 웹 대시보드를 통한 현황 확인

## 라이선스
MIT License

---
*마지막 업데이트: 2025-09-17*