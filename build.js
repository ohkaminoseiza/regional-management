#!/usr/bin/env node

/**
 * build.js — 地域経営ラボ ビルドスクリプト
 *
 * 1. summaries/ 内の Markdown を HTML に変換し /weekly/ に出力する（週刊ノート）
 * 2. cases/ 内の Markdown を HTML に変換し /casenotes/ に出力する（ケースノート）
 * また、index.html・weekly/index.html・casenotes/index.html の該当セクションを更新する。
 */

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { marked } = require('marked');

// ───────────────────────────────────────
// 設定
// ───────────────────────────────────────
const ROOT = __dirname;
const SUMMARIES_DIR = path.join(ROOT, 'summaries');
const WEEKLY_DIR = path.join(ROOT, 'weekly');
const CASES_DIR = path.join(ROOT, 'cases');
const CASENOTES_DIR = path.join(ROOT, 'casenotes');
const INDEX_HTML = path.join(ROOT, 'index.html');
const WEEKLY_INDEX_HTML = path.join(WEEKLY_DIR, 'index.html');
const CASENOTES_INDEX_HTML = path.join(CASENOTES_DIR, 'index.html');

/** ケースノートの対象領域（8分野）。cases/ の frontmatter category はこの語彙から選ぶ */
const CASE_CATEGORIES = [
  '地域運営組織・住民自治',
  '中心市街地・商店街再生',
  '公共施設・遊休資産活用',
  '河川・港湾・ウォーターフロント',
  '公共交通・地域モビリティ',
  '空き家・住宅・移住定住',
  '地域産業・観光・文化',
  'デジタル化・データ活用',
];

/** 候補台帳など、記事ではないメタファイル（ビルド対象外） */
const META_FILES = ['CASE_CANDIDATES.md', 'README.md'];

// ───────────────────────────────────────
// ユーティリティ
// ───────────────────────────────────────

/** summaries/ 配下の .md ファイルを再帰的に収集 */
function collectMarkdownFiles(dir) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(full));
    } else if (entry.name.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

/** 日付文字列を日本語表記に変換 */
function formatDateJa(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 日付文字列を YYYY.MM.DD に変換 */
function formatDateDot(dateStr) {
  const d = new Date(dateStr);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}.${mm}.${dd}`;
}

/** ファイル名から /weekly/ の HTML ファイル名を決定 */
function toWeeklyFilename(mdPath) {
  const base = path.basename(mdPath, '.md');
  return `${base}.html`;
}

/** Markdown から最初の段落テキストを抽出（概要に使用） */
function extractExcerpt(mdContent, maxLen = 120) {
  // frontmatter の後の本文から最初の意味のある段落を取得
  const lines = mdContent.split('\n');
  let excerpt = '';
  for (const line of lines) {
    const trimmed = line.trim();
    // 見出し、空行、区切り線、リスト項目をスキップ
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('---') ||
        trimmed.startsWith('-') || trimmed.startsWith('*') || trimmed.startsWith('|')) {
      continue;
    }
    // **太字のみ** の行もスキップ
    if (/^\*\*[^*]+\*\*$/.test(trimmed)) continue;
    excerpt = trimmed.replace(/\*\*/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    break;
  }
  if (excerpt.length > maxLen) {
    excerpt = excerpt.substring(0, maxLen) + '…';
  }
  return excerpt;
}

// ───────────────────────────────────────
// 記事パース
// ───────────────────────────────────────
function parseArticles() {
  const mdFiles = collectMarkdownFiles(SUMMARIES_DIR);
  const articles = [];

  for (const mdPath of mdFiles) {
    const raw = fs.readFileSync(mdPath, 'utf-8');
    const { data, content } = matter(raw);

    if (!data.date || !data.title) {
      console.warn(`⚠ スキップ (frontmatter 不足): ${mdPath}`);
      continue;
    }

    const dateStr = typeof data.date === 'object'
      ? data.date.toISOString().slice(0, 10)
      : String(data.date);

    // 本文の先頭にある # タイトル行を除去（frontmatter の title と重複するため）
    let cleanContent = content.replace(/^\s*#\s+.+\n*/m, '');

    articles.push({
      date: dateStr,
      title: data.title,
      theme: data.theme || '',
      sources: data.sources || [],
      contentMd: cleanContent,
      contentHtml: marked(cleanContent),
      excerpt: extractExcerpt(cleanContent),
      filename: toWeeklyFilename(mdPath),
      sourcePath: mdPath,
    });
  }

  // 日付の降順でソート（新しいものが先）
  articles.sort((a, b) => b.date.localeCompare(a.date));
  return articles;
}

/** cases/ 配下のケースノートをパース */
function parseCases() {
  const mdFiles = collectMarkdownFiles(CASES_DIR);
  const cases = [];

  for (const mdPath of mdFiles) {
    if (META_FILES.includes(path.basename(mdPath))) continue;

    const raw = fs.readFileSync(mdPath, 'utf-8');
    const { data, content } = matter(raw);

    if (!data.date || !data.title) {
      console.warn(`⚠ スキップ (frontmatter 不足): ${mdPath}`);
      continue;
    }

    const dateStr = typeof data.date === 'object'
      ? data.date.toISOString().slice(0, 10)
      : String(data.date);

    if (data.category && !CASE_CATEGORIES.includes(data.category)) {
      console.warn(`⚠ 未定義の category「${data.category}」: ${mdPath}`);
    }

    const cleanContent = content.replace(/^\s*#\s+.+\n*/m, '');

    cases.push({
      date: dateStr,
      title: data.title,
      region: data.region || '',
      category: data.category || '',
      period: data.period ? String(data.period) : '',
      status: data.status || '',
      block: data.block || '',
      sources: data.sources || [],
      contentHtml: marked(cleanContent),
      excerpt: extractExcerpt(cleanContent),
      filename: toWeeklyFilename(mdPath),
      sourcePath: mdPath,
    });
  }

  cases.sort((a, b) => b.date.localeCompare(a.date));
  return cases;
}

// ───────────────────────────────────────
// 共通パーツ
// ───────────────────────────────────────

/**
 * グローバルナビゲーションを生成
 * @param {string} current - 'home' | 'basic' | 'weekly' | 'cases' | 'about'
 * @param {string} prefix  - ルートへの相対パス（'' または '../'）
 */
function navHtml(current, prefix) {
  const items = [
    { key: 'home', href: `${prefix}index.html`, label: 'ホーム' },
    { key: 'basic', href: `${prefix}basic/index.html`, label: '地域経営の基本' },
    { key: 'weekly', href: `${prefix}weekly/index.html`, label: '週刊ノート' },
    { key: 'cases', href: `${prefix}casenotes/index.html`, label: 'ケースノート' },
    { key: 'about', href: `${prefix}about.html`, label: 'このサイトについて' },
  ];
  return items
    .map(i => `        <a href="${i.href}"${i.key === current ? ' aria-current="page"' : ''}>${i.label}</a>`)
    .join('\n');
}

function footerNavHtml(prefix) {
  return [
    `        <a href="${prefix}index.html">ホーム</a>`,
    `        <a href="${prefix}basic/index.html">地域経営の基本</a>`,
    `        <a href="${prefix}weekly/index.html">週刊ノート</a>`,
    `        <a href="${prefix}casenotes/index.html">ケースノート</a>`,
    `        <a href="${prefix}about.html">このサイトについて</a>`,
  ].join('\n');
}

// ───────────────────────────────────────
// HTML テンプレート
// ───────────────────────────────────────

function articlePageHtml(article, articles) {
  // 前後の記事を取得
  const idx = articles.findIndex(a => a.filename === article.filename);
  const newer = idx > 0 ? articles[idx - 1] : null;
  const older = idx < articles.length - 1 ? articles[idx + 1] : null;

  const prevNav = older
    ? `<a href="${older.filename}" class="article-nav__link">
        <span class="article-nav__label">← 前の記事</span>
        <span class="article-nav__title">${older.title}</span>
      </a>`
    : '<div></div>';

  const nextNav = newer
    ? `<a href="${newer.filename}" class="article-nav__link article-nav__link--next">
        <span class="article-nav__label">次の記事 →</span>
        <span class="article-nav__title">${newer.title}</span>
      </a>`
    : '<div></div>';

  const sourcesHtml = article.sources.length > 0
    ? `<details class="article-sources">
        <summary>出典・参考資料（${article.sources.length}件）</summary>
        <ul>${article.sources.map(s => `<li><a href="${s}" target="_blank" rel="noopener">${s}</a></li>`).join('\n')}</ul>
      </details>`
    : '';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${article.title} — 地域経営ラボ</title>
  <meta name="description" content="${article.excerpt}">
  <link rel="stylesheet" href="../style.css">
</head>
<body>

  <header class="site-header">
    <div class="container header-inner">
      <a href="../index.html" class="site-logo">
        <span class="site-logo__icon">📘</span>
        <span class="site-logo__text">地域経営ラボ</span>
        <span class="site-logo__sub">Regional Management Lab</span>
      </a>
      <nav class="site-nav" aria-label="メインナビゲーション">
${navHtml('weekly', '../')}
      </nav>
    </div>
  </header>

  <main>
    <div class="container">
      <article>
        <div class="article-header">
          <nav class="article-header__breadcrumb" aria-label="パンくずリスト">
            <a href="../index.html">ホーム</a><span class="sep">/</span>
            <a href="index.html">週刊・地域経営ノート</a><span class="sep">/</span>
            <span>${formatDateDot(article.date)}</span>
          </nav>
          <h1 class="article-header__title">${article.title}</h1>
          <div class="article-header__meta">
            <span>週刊・地域経営ノート</span>
            ${article.theme ? `<span>テーマ：${article.theme}</span>` : ''}
            <time datetime="${article.date}">${formatDateJa(article.date)}</time>
          </div>
        </div>

        <div class="article-body">
          ${article.contentHtml}
          ${sourcesHtml}
        </div>

        <nav class="article-nav" aria-label="記事ナビゲーション">
          ${prevNav}
          ${nextNav}
        </nav>
      </article>
    </div>
  </main>

  <footer class="site-footer">
    <div class="container footer-inner">
      <nav class="footer-nav" aria-label="フッターナビゲーション">
${footerNavHtml('../')}
      </nav>
      <p class="footer-copy">&copy; 2026 地域経営ラボ</p>
    </div>
  </footer>

</body>
</html>`;
}

function weeklyListItemHtml(article) {
  return `          <li class="weekly-list__item">
            <div class="weekly-list__info">
              <h2 class="weekly-list__title"><a href="${article.filename}">${article.title}</a></h2>
              <p class="weekly-list__excerpt">${article.excerpt}</p>
            </div>
            <time class="weekly-list__date" datetime="${article.date}">${formatDateDot(article.date)}</time>
          </li>`;
}

function weeklyIndexHtml(articles) {
  const listItems = articles.map(a => weeklyListItemHtml(a)).join('\n\n');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>週刊・地域経営ノート — 地域経営ラボ</title>
  <meta name="description" content="地域経営にまつわる最新トピックを毎週お届けする「週刊・地域経営ノート」のバックナンバー一覧です。">
  <link rel="stylesheet" href="../style.css">
</head>
<body>

  <header class="site-header">
    <div class="container header-inner">
      <a href="../index.html" class="site-logo">
        <span class="site-logo__icon">📘</span>
        <span class="site-logo__text">地域経営ラボ</span>
        <span class="site-logo__sub">Regional Management Lab</span>
      </a>
      <nav class="site-nav" aria-label="メインナビゲーション">
${navHtml('weekly', '../')}
      </nav>
    </div>
  </header>

  <main>
    <div class="container">
      <div class="page-header">
        <h1 class="page-header__title">週刊・地域経営ノート</h1>
        <p class="page-header__description">
          地域経営にまつわる最新の話題、事例、政策動向を毎週ピックアップしてお届けするコラムです。
          基礎記事と合わせてお読みいただくことで、理論と実践の両面から地域経営への理解が深まります。
          各記事のタイトル部分をクリックすると、全文を読むことができます。
        </p>
      </div>
    </div>

    <section class="section" id="weekly-list-section">
      <div class="container container--narrow">
        <ul class="weekly-list" id="weekly-articles">

${listItems}

        </ul>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container footer-inner">
      <nav class="footer-nav" aria-label="フッターナビゲーション">
${footerNavHtml('../')}
      </nav>
      <p class="footer-copy">&copy; 2026 地域経営ラボ</p>
    </div>
  </footer>

</body>
</html>`;
}

// ───────────────────────────────────────
// ケースノート HTML テンプレート
// ───────────────────────────────────────

function caseMetaHtml(c) {
  const rows = [
    ['対象地域', c.region],
    ['分野', c.category],
    ['対象期間', c.period],
    ['現在の状況', c.status],
  ].filter(([, v]) => v);

  if (rows.length === 0) return '';

  return `<dl class="case-meta">
${rows.map(([k, v]) => `            <div class="case-meta__row"><dt>${k}</dt><dd>${v}</dd></div>`).join('\n')}
          </dl>`;
}

function caseNotePageHtml(c, cases) {
  const idx = cases.findIndex(x => x.filename === c.filename);
  const newer = idx > 0 ? cases[idx - 1] : null;
  const older = idx < cases.length - 1 ? cases[idx + 1] : null;

  const prevNav = older
    ? `<a href="${older.filename}" class="article-nav__link">
        <span class="article-nav__label">← 前のケース</span>
        <span class="article-nav__title">${older.title}</span>
      </a>`
    : '<div></div>';

  const nextNav = newer
    ? `<a href="${newer.filename}" class="article-nav__link article-nav__link--next">
        <span class="article-nav__label">次のケース →</span>
        <span class="article-nav__title">${newer.title}</span>
      </a>`
    : '<div></div>';

  const sourcesHtml = c.sources.length > 0
    ? `<details class="article-sources">
        <summary>出典・参考資料（${c.sources.length}件）</summary>
        <ul>${c.sources.map(s => `<li><a href="${s}" target="_blank" rel="noopener">${s}</a></li>`).join('\n')}</ul>
      </details>`
    : '';

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${c.title} — 地域経営ラボ</title>
  <meta name="description" content="${c.excerpt}">
  <link rel="stylesheet" href="../style.css">
</head>
<body>

  <header class="site-header">
    <div class="container header-inner">
      <a href="../index.html" class="site-logo">
        <span class="site-logo__icon">📘</span>
        <span class="site-logo__text">地域経営ラボ</span>
        <span class="site-logo__sub">Regional Management Lab</span>
      </a>
      <nav class="site-nav" aria-label="メインナビゲーション">
${navHtml('cases', '../')}
      </nav>
    </div>
  </header>

  <main>
    <div class="container">
      <article>
        <div class="article-header">
          <nav class="article-header__breadcrumb" aria-label="パンくずリスト">
            <a href="../index.html">ホーム</a><span class="sep">/</span>
            <a href="index.html">地域経営ケースノート</a><span class="sep">/</span>
            <span>${formatDateDot(c.date)}</span>
          </nav>
          <h1 class="article-header__title">${c.title}</h1>
          <div class="article-header__meta">
            <span>地域経営ケースノート</span>
            <time datetime="${c.date}">${formatDateJa(c.date)}</time>
          </div>
          ${caseMetaHtml(c)}
        </div>

        <div class="article-body">
          ${c.contentHtml}
          ${sourcesHtml}
        </div>

        <nav class="article-nav" aria-label="記事ナビゲーション">
          ${prevNav}
          ${nextNav}
        </nav>
      </article>
    </div>
  </main>

  <footer class="site-footer">
    <div class="container footer-inner">
      <nav class="footer-nav" aria-label="フッターナビゲーション">
${footerNavHtml('../')}
      </nav>
      <p class="footer-copy">&copy; 2026 地域経営ラボ</p>
    </div>
  </footer>

</body>
</html>`;
}

function caseListItemHtml(c, { heading = 'h2', prefix = '' } = {}) {
  const badges = [c.region, c.category, c.period]
    .filter(Boolean)
    .map(v => `<span class="case-badge">${v}</span>`)
    .join('');

  return `          <li class="weekly-list__item">
            <div class="weekly-list__info">
              <${heading} class="weekly-list__title"><a href="${prefix}${c.filename}">${c.title}</a></${heading}>
              <p class="case-badges">${badges}</p>
              <p class="weekly-list__excerpt">${c.excerpt}</p>
            </div>
            <time class="weekly-list__date" datetime="${c.date}">${formatDateDot(c.date)}</time>
          </li>`;
}

function casenotesIndexHtml(cases) {
  const listItems = cases.length > 0
    ? cases.map(c => caseListItemHtml(c)).join('\n\n')
    : '          <li class="weekly-list__item"><div class="weekly-list__info"><p class="weekly-list__excerpt">ケースノートは現在準備中です。</p></div></li>';

  // 分野別の掲載件数
  const counts = CASE_CATEGORIES.map(cat => ({
    cat,
    n: cases.filter(c => c.category === cat).length,
  }));
  const categoryList = counts
    .map(({ cat, n }) => `            <li class="case-index__cat"><span>${cat}</span><span class="case-index__count">${n}</span></li>`)
    .join('\n');

  return `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>地域経営ケースノート — 地域経営ラボ</title>
  <meta name="description" content="全国の地域経営・まちづくりの取組を、着手前から現在までの経過にそって整理する「地域経営ケースノート」の一覧です。">
  <link rel="stylesheet" href="../style.css">
</head>
<body>

  <header class="site-header">
    <div class="container header-inner">
      <a href="../index.html" class="site-logo">
        <span class="site-logo__icon">📘</span>
        <span class="site-logo__text">地域経営ラボ</span>
        <span class="site-logo__sub">Regional Management Lab</span>
      </a>
      <nav class="site-nav" aria-label="メインナビゲーション">
${navHtml('cases', '../')}
      </nav>
    </div>
  </header>

  <main>
    <div class="container">
      <div class="page-header">
        <h1 class="page-header__title">地域経営ケースノート</h1>
        <p class="page-header__description">
          全国の地域経営・まちづくりの取組を1件ずつ取り上げ、着手前の地域課題から現在までの経過を、
          公的な一次資料を中心に整理する記録です。成功事例の紹介ではなく、
          その取組がどのような条件のもとで成立し、何が課題として残っているのかを検討します。
          事業主体による自己評価と第三者が確認した成果は区別して記述しています。
        </p>
      </div>
    </div>

    <section class="section" id="case-categories">
      <div class="container container--narrow">
        <div class="case-index">
          <h2 class="case-index__title">対象領域</h2>
          <ul class="case-index__list">
${categoryList}
          </ul>
        </div>
      </div>
    </section>

    <section class="section section--alt" id="case-list-section">
      <div class="container container--narrow">
        <ul class="weekly-list" id="case-articles">

${listItems}

        </ul>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container footer-inner">
      <nav class="footer-nav" aria-label="フッターナビゲーション">
${footerNavHtml('../')}
      </nav>
      <p class="footer-copy">&copy; 2026 地域経営ラボ</p>
    </div>
  </footer>

</body>
</html>`;
}

// ───────────────────────────────────────
// index.html の最新記事セクション更新
// ───────────────────────────────────────
/** <!-- NAME_START --> 〜 <!-- NAME_END --> の間を置換 */
function replaceMarkedSection(html, name, body) {
  const startMarker = `<!-- ${name}_START -->`;
  const endMarker = `<!-- ${name}_END -->`;
  const startIdx = html.indexOf(startMarker);
  const endIdx = html.indexOf(endMarker);

  if (startIdx === -1 || endIdx === -1) {
    console.warn(`⚠ index.html に ${name} のマーカーコメントが見つかりません。該当セクションは更新されませんでした。`);
    return null;
  }

  return html.substring(0, startIdx + startMarker.length) +
    '\n' + body + '\n        ' +
    html.substring(endIdx);
}

function updateTopPage(articles, cases) {
  if (!fs.existsSync(INDEX_HTML)) {
    console.warn('⚠ index.html が見つかりません');
    return;
  }

  let html = fs.readFileSync(INDEX_HTML, 'utf-8');

  // 週刊ノート 最新3件
  const latest = articles.slice(0, 3);
  const latestListItems = latest.map(a =>
    `          <li class="weekly-list__item">
            <div class="weekly-list__info">
              <h3 class="weekly-list__title"><a href="weekly/${a.filename}">${a.title}</a></h3>
              <p class="weekly-list__excerpt">${a.excerpt}</p>
            </div>
            <time class="weekly-list__date" datetime="${a.date}">${formatDateDot(a.date)}</time>
          </li>`
  ).join('\n');

  const afterWeekly = replaceMarkedSection(html, 'WEEKLY', latestListItems);
  if (afterWeekly) {
    html = afterWeekly;
    console.log(`✓ index.html の週刊ノートセクションを更新（${latest.length}件）`);
  }

  // ケースノート 最新3件
  const latestCases = cases.slice(0, 3);
  const caseListItems = latestCases.length > 0
    ? latestCases.map(c => caseListItemHtml(c, { heading: 'h3', prefix: 'casenotes/' })).join('\n')
    : '          <li class="weekly-list__item"><div class="weekly-list__info"><p class="weekly-list__excerpt">ケースノートは現在準備中です。</p></div></li>';

  const afterCases = replaceMarkedSection(html, 'CASES', caseListItems);
  if (afterCases) {
    html = afterCases;
    console.log(`✓ index.html のケースノートセクションを更新（${latestCases.length}件）`);
  }

  fs.writeFileSync(INDEX_HTML, html, 'utf-8');
}

// ───────────────────────────────────────
// メイン
// ───────────────────────────────────────
function main() {
  console.log('📘 地域経営ラボ — ビルド開始\n');

  // ── 週刊ノート ──
  const articles = parseArticles();
  console.log(`週刊ノート: ${articles.length}件`);

  if (articles.length === 0) {
    console.log('  ⚠ summaries/ に記事が見つかりません。');
  } else {
    if (!fs.existsSync(WEEKLY_DIR)) {
      fs.mkdirSync(WEEKLY_DIR, { recursive: true });
    }
    for (const article of articles) {
      const outPath = path.join(WEEKLY_DIR, article.filename);
      fs.writeFileSync(outPath, articlePageHtml(article, articles), 'utf-8');
      console.log(`  ✓ weekly/${article.filename}`);
    }
    fs.writeFileSync(WEEKLY_INDEX_HTML, weeklyIndexHtml(articles), 'utf-8');
    console.log(`  ✓ weekly/index.html`);
  }

  // ── ケースノート ──
  const cases = parseCases();
  console.log(`\nケースノート: ${cases.length}件`);

  if (!fs.existsSync(CASENOTES_DIR)) {
    fs.mkdirSync(CASENOTES_DIR, { recursive: true });
  }
  for (const c of cases) {
    const outPath = path.join(CASENOTES_DIR, c.filename);
    fs.writeFileSync(outPath, caseNotePageHtml(c, cases), 'utf-8');
    console.log(`  ✓ casenotes/${c.filename}`);
  }
  fs.writeFileSync(CASENOTES_INDEX_HTML, casenotesIndexHtml(cases), 'utf-8');
  console.log(`  ✓ casenotes/index.html`);

  // ── トップページ ──
  console.log('');
  updateTopPage(articles, cases);

  console.log('\n✅ ビルド完了');
}

main();
