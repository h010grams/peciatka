# Деплой: Railway (или Render) + Neon

Один контейнер (Dockerfile) отдаёт API, фронт и PassKit Web Service с одного домена.
Миграции применяются автоматически при старте (`prisma migrate deploy`).

> **HTTPS обязателен:** без него не работают Apple Wallet (webServiceURL), камера в браузере и Secure-cookie.
> Railway и Render выдают HTTPS автоматически — и на своём поддомене, и на вашем домене.

## 1. База данных — Neon

1. https://neon.tech → New project → регион **Frankfurt (eu-central-1)** (близко к Словакии, данные в ЕС).
2. Скопируйте **Direct connection string** (без `-pooler` в хосте) — Prisma-миграциям нужно прямое подключение.
   Вид: `postgresql://user:pass@ep-xxx.eu-central-1.aws.neon.tech/neondb?sslmode=require`
3. Включите автоматические бэкапы (Point-in-time restore) — на бесплатном тарифе хранятся ограниченно, для продакшена возьмите платный.

Supabase тоже подходит: Project Settings → Database → Connection string → **Session mode / direct**.

## 2. Приложение — Railway

1. Залейте код в GitHub (приватный репозиторий).
2. https://railway.app → New Project → Deploy from GitHub repo → выберите репозиторий. Railway найдёт `Dockerfile`.
3. Settings → Networking → **Generate Domain** (или Custom Domain, см. п. 4). Порт: `3001`.
4. Settings → Deploy → Healthcheck Path: `/api/health`.
5. Variables (минимум):

| Переменная | Значение |
|---|---|
| `DATABASE_URL` | строка из Neon |
| `APP_URL` | `https://karty.vasadomena.sk` (без `/` в конце) — **точно тот адрес, который видят клиенты** |
| `NODE_ENV` | `production` |
| `PORT` | `3001` |
| `RESEND_API_KEY` | ключ Resend (п. 5) |
| `MAIL_FROM` | `Pečiatka <noreply@vasadomena.sk>` |
| `APP_NAME` | название сервиса |

Wallet-переменные — в п. 6 и 7. После изменения переменных Railway перезапускает сервис сам.

### Render (альтернатива)
New → Web Service → репозиторий → Runtime **Docker** → Instance type: Starter (бесплатный засыпает — Wallet-запросы будут таймаутить) → те же переменные → Health Check Path `/api/health`.

### Масштабирование
Фоновые задачи (синхронизация Wallet, напоминания) работают внутри того же процесса. Несколько инстансов безопасны:
задачи забираются через `FOR UPDATE SKIP LOCKED`, напоминания помечаются атомарно. Для MVP хватит одного инстанса.

## 3. Свой домен

Купите домен (например, `.sk` у WebSupport) → в Railway: Custom Domain → добавьте CNAME у регистратора → дождитесь сертификата.
После этого **обновите `APP_URL`**. Важно: адрес попадает в QR-постеры и в карты Wallet, поэтому выберите его до печати постеров.

## 4. Почта — Resend

1. https://resend.com → Domains → добавьте домен → пропишите DNS-записи (SPF, DKIM) у регистратора.
2. API Keys → создайте ключ → `RESEND_API_KEY`.
3. Без ключа письма (приглашения, сброс пароля) только пишутся в лог сервера.

## 5. Apple Wallet

Нужны: Pass Type ID, сертификат к нему (экспорт `.p12` из Keychain) и сертификат Apple WWDR G4 — как их получить, см. раздел «Wallet: что получить заранее» в README.

```bash
openssl pkcs12 -legacy -in pass.p12 -clcerts -nokeys -out signerCert.pem
```
```bash
openssl pkcs12 -legacy -in pass.p12 -nocerts -out signerKey.pem
```
```bash
openssl x509 -inform der -in AppleWWDRCAG4.cer -out wwdr.pem
```

Переменные (base64, чтобы многострочный PEM поместился в одну строку):

```bash
base64 -i signerCert.pem | pbcopy
```
→ `APPLE_SIGNER_CERT_B64`; так же `signerKey.pem` → `APPLE_SIGNER_KEY_B64`, `wwdr.pem` → `APPLE_WWDR_CERT_B64`.
Плюс `APPLE_PASS_TYPE_ID` (например `pass.sk.peciatka.loyalty`), `APPLE_TEAM_ID`, `APPLE_SIGNER_KEY_PASSPHRASE` (пароль ключа, если задавали при экспорте).

Локально вместо переменных можно положить `signerCert.pem`, `signerKey.pem`, `wwdr.pem` в папку `certs/` (она в `.gitignore`).

**Проверка:** в логе при старте — `Wallet: Apple on`. На iPhone откройте карту клиента (`/c/...`) в Safari → «Pridať do Apple Wallet».
Если карта не добавляется — смотрите лог: Wallet шлёт ошибки на `/api/wallet/apple/v1/log`.

**Не забудьте:** сертификат Pass Type ID действует **1 год**. Поставьте напоминание за месяц: выпустите новый, обновите переменные — уже выданные карты продолжат работать.

## 6. Google Wallet

1. Google Cloud: проект → включить **Google Wallet API** → IAM → Service Accounts → создать → Keys → Add key → JSON.
2. https://pay.google.com/business/console → Google Wallet API → скопируйте **Issuer ID** → Users → пригласите email сервисного аккаунта (роль Developer).
3. Переменные:

```bash
base64 -i service-account.json | pbcopy
```
→ `GOOGLE_WALLET_SA_KEY_B64`, и `GOOGLE_WALLET_ISSUER_ID`.

**Demo mode:** пока Google не одобрил выпуск, карты помечены «TEST ONLY» и сохраняются только у аккаунтов, добавленных в Wallet Console (Users / test accounts).
Когда всё работает — Wallet Console → **Request publishing access** (нужны описание бизнеса и скриншоты процесса). Одобрение — от нескольких дней.

**Проверка:** в логе — `Wallet: Google on`. На Android откройте `/c/...` → «Pridať do Google Wallet».

## 7. Чек-лист после деплоя (на реальных телефонах)

1. `https://ваш-домен/api/health` → `{"ok":true}`.
2. Зарегистрируйте салон, создайте программу, загрузите логотип.
3. Скачайте постер A4, распечатайте, отсканируйте камерой iPhone и Android.
4. Зарегистрируйтесь как клиентка → добавьте карту в Apple Wallet и в Google Wallet.
5. На втором телефоне войдите как мастер (пригласите себя на другой email) → «Skener» → наведите камеру на QR в Wallet → **+1 pečiatka**.
   Через несколько секунд карта в Wallet обновится и придёт уведомление «Pribudla pečiatka: 1 z 10…».
6. Поставьте лимит 0 часов, доведите до награды → уведомление о награде → «Uplatniť odmenu».
7. Назначьте следующий визит на «послезавтра» → дата появится на карте; напоминание придёт за сутки.
8. Удалите тестовую клиентку → карта в Wallet станет недействительной.
9. Мастер: «Добавить на главный экран» (Safari → Поделиться) — сканер открывается как приложение.

## 8. Эксплуатация

- **Логи:** Railway → Deployments → View logs. Ошибки синхронизации Wallet помечены `[wallet]`.
- **Бэкапы:** Neon PITR; раз в месяц проверяйте восстановление на копии.
- **Новые миграции:** локально `pnpm --filter api db:migrate --name <имя>` → коммит → деплой применит сам.
- **Юридическое:** текст согласия и страница `/j/<salon>/privacy` — шаблон. Перед запуском покажите юристу
  и заключите с салонами договор об обработке данных (zmluva o spracúvaní osobných údajov, čl. 28 GDPR).
  При изменении текста согласия увеличьте `CONSENT_VERSION` в `packages/shared/src/index.ts`.
- **Кнопки Wallet:** перед публичным запуском замените текстовые кнопки на официальные бейджи
  «Add to Apple Wallet» (Apple Marketing Guidelines) и «Add to Google Wallet» (Google brand guidelines) — этого требуют правила обеих платформ.
