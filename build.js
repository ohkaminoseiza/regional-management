#!/usr/bin/env node

/**
 * build.js — 地域経営ラボ 週刊ノート ビルドスクリプト
 *
 * summaries/ 内の Markdown ファイルを HTML に変換し、
 * /weekly/ 配下に静的ページとして出力する。
 * また、index.html と weekly/index.html の該当セクションを更新する。
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
const INDEX_HTML = path.join(ROOT, 'index.html');
const WEEKLY_INDEX_HTML = path.join(WEEKLY_DIR, 'index.html');

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
        <a href="../index.html">ホーム</a>
        <a href="../basic/index.html">地域経営の基本</a>
        <a href="index.html" aria-current="page">週刊ノート</a>
        <a href="../about.html">このサイトについて</a>
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
        <a href="../index.html">ホーム</a>
        <a href="../basic/index.html">地域経営の基本</a>
        <a href="index.html">週刊ノート</a>
        <a href="../about.html">このサイトについて</a>
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
        <a href="../index.html">ホーム</a>
        <a href="../basic/index.html">地域経営の基本</a>
        <a href="index.html" aria-current="page">週刊ノート</a>
        <a href="../about.html">このサイトについて</a>
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
        <a href="../index.html">ホーム</a>
        <a href="../basic/index.html">地域経営の基本</a>
        <a href="index.html">週刊ノート</a>
        <a href="../about.html">このサイトについて</a>
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
function updateTopPageLatest(articles) {
  if (!fs.existsSync(INDEX_HTML)) {
    console.warn('⚠ index.html が見つかりません');
    return;
  }

  let html = fs.readFileSync(INDEX_HTML, 'utf-8');

  // 最新3件を表示
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

  // <!-- WEEKLY_START --> 〜 <!-- WEEKLY_END --> の間を置換
  const startMarker = '<!-- WEEKLY_START -->';
  const endMarker = '<!-- WEEKLY_END -->';
  const startIdx = html.indexOf(startMarker);
  const endIdx = html.indexOf(endMarker);

  if (startIdx !== -1 && endIdx !== -1) {
    html = html.substring(0, startIdx + startMarker.length) +
      '\n' + latestListItems + '\n        ' +
      html.substring(endIdx);
  } else {
    console.warn('⚠ index.html にマーカーコメントが見つかりません。最新記事セクションは更新されませんでした。');
    return;
  }

  fs.writeFileSync(INDEX_HTML, html, 'utf-8');
  console.log(`✓ index.html の最新記事セクションを更新（${latest.length}件）`);
}

// ───────────────────────────────────────
// メイン
// ───────────────────────────────────────
function main() {
  console.log('📘 地域経営ラボ — ビルド開始\n');

  // 1. 記事をパース
  const articles = parseArticles();
  console.log(`  記事数: ${articles.length}`);

  if (articles.length === 0) {
    console.log('  ⚠ summaries/ に記事が見つかりません。');
    return;
  }

  // 2. weekly/ ディレクトリを確保
  if (!fs.existsSync(WEEKLY_DIR)) {
    fs.mkdirSync(WEEKLY_DIR, { recursive: true });
  }

  // 3. 各記事の HTML を生成
  for (const article of articles) {
    const outPath = path.join(WEEKLY_DIR, article.filename);
    const html = articlePageHtml(article, articles);
    fs.writeFileSync(outPath, html, 'utf-8');
    console.log(`  ✓ ${article.filename}`);
  }

  // 4. weekly/index.html を生成
  const indexHtml = weeklyIndexHtml(articles);
  fs.writeFileSync(WEEKLY_INDEX_HTML, indexHtml, 'utf-8');
  console.log(`  ✓ weekly/index.html`);

  // 5. index.html の最新記事セクションを更新
  updateTopPageLatest(articles);

  console.log('\n✅ ビルド完了');
}

main();
