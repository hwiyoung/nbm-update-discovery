# NBM Update Discovery v1.2.3 빠른 업데이트 가이드

자세한 설명과 중단 조건은 [상세 가이드](./DEPLOY_UPGRADE_GUIDE_v1.2.3.md)를 먼저 확인한다.

## 절대 금지

- `docker compose down -v`
- 기존 설치 폴더에 새 패키지 덮어쓰기
- 오프라인 PC에서 `docker compose build`
- DB backup 확인 전 기존 서비스 중지
- 설치 검증 전 기존 폴더와 이미지 삭제

## 요약 절차

```bash
OLD_VERSION=1.2.2
OLD_DIR="$HOME/nbm-update-discovery_v${OLD_VERSION}/install/nbm-update-discovery"
NEW_ROOT="$HOME/nbm-update-discovery_v1.2.3"
NEW_DIR="$NEW_ROOT/install/nbm-update-discovery"
BACKUP_DIR="$HOME/nbm-backups"
```

1. 기존 상태와 활성 작업을 확인한다.
2. `$NEW_ROOT`에서 `sha256sum -c SHA256SUMS`를 실행한다.
3. 앱 이미지와 모델 압축을 `$NEW_ROOT/install`에 차례로 해제한다.
4. 기존 `.env.prod`와 PostgreSQL을 백업한다.
5. 기존 `.env.prod`를 새 폴더로 복사하고 `APP_VERSION=1.2.3`만 변경한다.
6. `unset APP_VERSION` 후 Compose 이미지가 모두 `:1.2.3`인지 확인한다.
7. 새 폴더에서 `scripts/load-images.sh`로 이미지를 선적재한다.
8. 기존 폴더에서 `docker compose ... down`을 실행한다. `-v`는 붙이지 않는다.
9. 새 폴더에서 `scripts/install-offline.sh --skip-load --skip-seed`를 실행한다.
10. `/health`, 기존 데이터 개수, GPU, 모델과 브라우저 기능을 확인한다.

성공 기준:

```text
offline verification passed: version=1.2.3 url=http://127.0.0.1:18200/
```

이번 버전은 DB migration을 추가하지 않았다. 문제가 발생하면 새 스택을 일반 `down`으로 중지하고 보관한 기존 폴더와 이미지로 다시 기동할 수 있다. DB 내용 자체를 되돌려야 할 때만 업데이트 직전 dump를 복원한다.
