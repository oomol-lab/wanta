import type { AppLocale } from "../app-locale.ts"

interface SpacesCopy {
  project: string
  month: string
  confirm: string
  cancel: string
  prototype: string
  header: string
  create: string
  deploy: string
  billing: string
  access: string
  deployment: string
}

export const spacesCopy: Record<AppLocale, SpacesCopy> = {
  en: {
    project: "Project",
    month: "month",
    header: "Spaces",
    confirm: "Confirm",
    cancel: "Cancel",
    prototype: "Prototype first",
    create: "Create one Space and deploy this website",
    deploy: "Deploy this website to the existing Space",
    billing:
      "Charged immediately for one month and renewed automatically each month. Deleting does not refund the current period. Insufficient renewal balance suspends the website; after the grace period its data is permanently deleted.",
    access: "Team visibility protects the website entrance; the app must enforce its own database access permissions.",
    deployment:
      "This updates the live backend and frontend. A failed frontend build can leave the new backend live. Frontend rollback does not restore the database.",
  },
  "zh-CN": {
    project: "项目",
    month: "月",
    header: "Spaces",
    confirm: "确认使用",
    cancel: "取消",
    prototype: "先做原型",
    create: "创建一个 Space 并部署本次网站",
    deploy: "将本次网站部署到已有 Space",
    billing:
      "创建立即收取一个月费用，之后每月自动续费。删除不退还当前周期费用。续费余额不足会暂停网站，宽限期结束后数据将被永久删除。",
    access: "团队可见性只保护网站入口，应用必须自行验证数据库访问权限。",
    deployment: "这将更新线上后端和前端。前端构建失败时，新后端可能已经生效。前端回滚不会恢复数据库。",
  },
  "zh-TW": {
    project: "專案",
    month: "月",
    header: "Spaces",
    confirm: "確認使用",
    cancel: "取消",
    prototype: "先做原型",
    create: "建立一個 Space 並部署本次網站",
    deploy: "將本次網站部署到現有 Space",
    billing:
      "建立時立即收取一個月費用，之後每月自動續費。刪除不退還當期費用。續費餘額不足會暫停網站，寬限期結束後資料將永久刪除。",
    access: "團隊可見性只保護網站入口，應用程式必須自行驗證資料庫存取權限。",
    deployment: "這將更新線上後端和前端。前端建置失敗時，新後端可能已生效。前端回復不會還原資料庫。",
  },
  ja: {
    project: "プロジェクト",
    month: "月",
    header: "Spaces",
    confirm: "確認して実行",
    cancel: "キャンセル",
    prototype: "先に試作",
    create: "Space を1つ作成し、このサイトをデプロイ",
    deploy: "既存の Space にサイトをデプロイ",
    billing:
      "作成時に1か月分を請求し、毎月自動更新します。削除しても当期分は返金されません。残高不足で停止し、猶予期間後にデータを完全に削除します。",
    access: "チーム公開設定はサイト入口のみを保護します。データベースの権限はアプリ側で検証が必要です。",
    deployment:
      "公開中のバックエンドとフロントエンドを更新します。ビルド失敗後も新しいバックエンドが残る場合があります。フロントエンドの復元はデータベースを復元しません。",
  },
  ko: {
    project: "프로젝트",
    month: "월",
    header: "Spaces",
    confirm: "확인 후 실행",
    cancel: "취소",
    prototype: "먼저 시제품 제작",
    create: "Space 하나를 만들고 웹사이트 배포",
    deploy: "기존 Space에 웹사이트 배포",
    billing:
      "생성 즉시 한 달 요금이 청구되며 매월 자동 갱신됩니다. 삭제해도 현재 기간은 환불되지 않습니다. 잔액 부족 시 중지되고 유예 기간 후 데이터가 영구 삭제됩니다.",
    access: "팀 공개 설정은 사이트 입구만 보호합니다. 앱이 데이터베이스 접근 권한을 검증해야 합니다.",
    deployment:
      "운영 중인 백엔드와 프런트엔드를 갱신합니다. 빌드 실패 후에도 새 백엔드가 유지될 수 있습니다. 프런트엔드 롤백은 데이터베이스를 복구하지 않습니다.",
  },
  ru: {
    project: "Проект",
    month: "месяц",
    header: "Spaces",
    confirm: "Подтвердить",
    cancel: "Отмена",
    prototype: "Сначала прототип",
    create: "Создать один Space и развернуть сайт",
    deploy: "Развернуть сайт в существующем Space",
    billing:
      "Месяц оплачивается сразу, затем продлевается автоматически. Удаление не возвращает оплату текущего периода. При нехватке средств сайт приостанавливается, а после льготного периода данные удаляются навсегда.",
    access: "Доступ команды защищает только вход на сайт. Приложение должно проверять права доступа к базе данных.",
    deployment:
      "Обновляются рабочие сервер и интерфейс. После ошибки сборки интерфейса новый сервер может остаться активным. Откат интерфейса не восстанавливает базу данных.",
  },
  fr: {
    project: "Projet",
    month: "mois",
    header: "Spaces",
    confirm: "Confirmer",
    cancel: "Annuler",
    prototype: "Créer un prototype",
    create: "Créer un Space et déployer ce site",
    deploy: "Déployer ce site dans le Space existant",
    billing:
      "Un mois est facturé immédiatement, puis renouvelé automatiquement chaque mois. La suppression ne rembourse pas la période en cours. Un solde insuffisant suspend le site ; après le délai de grâce, ses données sont définitivement supprimées.",
    access:
      "La visibilité d’équipe protège seulement l’entrée du site. L’application doit vérifier les autorisations de la base de données.",
    deployment:
      "Le serveur et l’interface en production seront mis à jour. Un échec de compilation peut laisser le nouveau serveur actif. Restaurer l’interface ne restaure pas la base de données.",
  },
  es: {
    project: "Proyecto",
    month: "mes",
    header: "Spaces",
    confirm: "Confirmar",
    cancel: "Cancelar",
    prototype: "Primero un prototipo",
    create: "Crear un Space y desplegar este sitio",
    deploy: "Desplegar este sitio en el Space existente",
    billing:
      "Se cobra un mes inmediatamente y se renueva automáticamente cada mes. Eliminarlo no reembolsa el período actual. Un saldo insuficiente suspende el sitio; tras el período de gracia sus datos se eliminan permanentemente.",
    access:
      "La visibilidad del equipo solo protege la entrada al sitio. La aplicación debe verificar los permisos de la base de datos.",
    deployment:
      "Se actualizan el servidor y la interfaz en producción. Un fallo de compilación puede dejar el nuevo servidor activo. Revertir la interfaz no restaura la base de datos.",
  },
}
