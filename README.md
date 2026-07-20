# lunRentBot

Бот, що моніторить нові оголошення оренди на **LUN** (`lun.ua`), рахує **час до офісу**
(пішки через OpenRouteService і «метро + ходьба» через Google Maps) і шле в **Telegram**
ті, що ≤ 40 хв пішки **або** ≤ 35 хв метром. Крутиться безкоштовно на **GitHub Actions**
(запуск раз на ~20 хв через зовнішній тригер cron-job.org).

LUN — агрегатор, який тягне оголошення з OLX, Rieltor, DIM.RIA тощо, тож одного джерела
вистачає, щоб покрити майже весь ринок Києва.

## Як це працює

1. `index.js` тягне нові оголошення з внутрішнього JSON-API LUN (`lun.ua/api/v2/market/realties`),
   відсортовані за датою публікації.
2. Фільтрує по валюті/ціні (UAH, ≤ 25 000) і відкидає вже бачені (`seen.json`).
3. Грубий префільтр по прямій (haversine) лишає тільки те, що поряд з офісом.
4. OpenRouteService рахує час пішки одним запитом (matrix) для всіх кандидатів.
5. Playwright скрейпить Google Maps (режим transit) для часу «метро + ходьба» (якщо `transit.enabled`).
6. Летить у Telegram те, що ≤ `maxWalkMinutes` пішки **АБО** ≤ `transit.maxMinutes` метром.
7. `seen.json` оновлюється і коммітиться назад у репо (так зберігається стан між запусками).

## Налаштування

### 1. Telegram-бот

1. Напиши [@BotFather](https://t.me/BotFather) → `/newbot` → отримай **токен**.
2. Напиши своєму новому боту будь-що (щоб він міг тобі писати).
3. Дізнайся свій `chat_id`: відкрий
   `https://api.telegram.org/bot<ТОКЕН>/getUpdates` і знайди `"chat":{"id":...}`.

### 2. OpenRouteService

Зареєструйся на [openrouteservice.org/dev](https://openrouteservice.org/dev/#/signup)
(безкоштовно, без картки) → створи **API key**. Безкоштовний ліміт із запасом покриває
запуск кожні 20 хв.

### 3. Час «метро + ходьба» (Google Maps + Playwright)

ORS не вміє маршрути транспортом, тож час метро дістаємо скрейпом **Google Maps** (режим
transit) через **Playwright** — без окремого сервера й без API-ключа. Потрібен лише
браузер Chromium:

```bash
npm install
npx playwright install chromium
```

Якщо Google недоступний або показав cookie-стіну — бот не падає, а просто працює як
раніше (тільки пішки). Вимкнути транзит цілком: `transit.enabled = false` у `config.js`
(тоді Playwright/Chromium узагалі не потрібні).

> ⚠️ Це скрейпінг Google Maps — формально проти його ToS і **крихкий**: Google може
> змінити верстку або показати cookie-згоду на IP раннера GitHub Actions. Ок для приватного
> pet-проєкту. Потрібна максимальна надійність — бери офіційний Google Directions API
> (`mode=transit`, потрібен ключ і білінг).

### 4. Локальний запуск (для тесту)

```bash
cp .env.example .env   # і заповни значення
node --env-file=.env index.js
```

Сухий прогін без надсилання в Telegram:

```bash
DRY_RUN=1 node --env-file=.env index.js
```

> ℹ️ **Перший запуск** (порожній `seen.json`) навмисно надсилає одразу весь батч актуальних
> варіантів — щоб побачити все, що зараз підходить. Далі летять лише нові оголошення.

### 5. GitHub Actions (безкоштовний хостинг)

1. Створи приватний репозиторій і запуш туди цей проєкт.
2. **Settings → Secrets and variables → Actions → New repository secret** — додай три:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `ORS_API_KEY`
3. **Settings → Actions → General → Workflow permissions** → увімкни
   **Read and write permissions** (щоб бот міг коммітити `seen.json`).
4. Вкладка **Actions** → запусти workflow `check-rent` вручну (`Run workflow`) для першого
   прогону. Для регулярних запусків налаштуй зовнішній тригер (напр. cron-job.org), який
   раз на ~20 хв смикає `workflow_dispatch` через GitHub API (рідний `schedule` не
   використовуємо через його затримки/пропуски).

## Зміна параметрів пошуку

Усе в `config.js`:

| Параметр | Що означає |
|---|---|
| `office.address` / `office.coords` | адреса офісу (геокодиться) і фолбек-координати `[lon, lat]` |
| `lun.priceTo` / `priceFrom` | діапазон ціни |
| `lun.currency` | `UAH` \| `USD` \| `EUR` |
| `lun.roomsFrom` / `roomsTo` | к-сть кімнат (або `null`) |
| `lun.pagesToFetch` | скільки сторінок нових тягнути (24 на сторінці) |
| `maxWalkMinutes` | поріг часу пішки |
| `prefilterRadiusKm` | радіус грубого відсіву по прямій |
| `transit.enabled` | вмикає фільтр «метро + ходьба» (Google Maps + Playwright) |
| `transit.maxMinutes` | поріг часу метром + ходьба |
| `transit.departAt` | час виїзду для розрахунку (наступний будній за Києвом), `"HH:MM"` |
| `transit.prefilterRadiusKm` | радіус відсіву для транзитних кандидатів |

## Обмеження (чесно)

- Це **неофіційний API** LUN — він може змінитися, і тоді бота доведеться чинити.
- Скрейпінг формально проти ToS LUN; ок для приватного pet-проєкту, але не для продакшну.
- GitHub cron іноді **затримує** запуск на кілька хвилин під навантаженням — це нормально.
