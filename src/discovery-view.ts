import { addSearchClear } from './search-clear';
import { Component, ItemView, Notice, setIcon, type WorkspaceLeaf } from 'obsidian';
import type PersonalRssPlugin from './main';
import { categories, discoveryFeeds, filterDiscovery } from './discovery';

export const DISCOVERY_VIEW_TYPE = 'personal-rss-reader-discovery';
export class DiscoveryPanel extends Component {
  private cards!: HTMLElement;
  private count!: HTMLElement;
  private query = '';
  private category = '全部';
  private pending = new Set<string>();
  private errors = new Map<string, string>();
  private closed = false;
  constructor(private contentEl: HTMLElement, private plugin: PersonalRssPlugin, private embedded = false) { super(); }
  onload() {
    this.closed = false; this.contentEl.empty(); this.contentEl.addClass('qrs-discovery');
    const page = this.contentEl.createDiv('qrs-discovery-page');
    const header = page.createDiv('qrs-discovery-header'); header.toggleClass('qrs-hidden', this.embedded);
    const intro = header.createDiv();
    intro.createEl('h1', { text: '发现值得读的内容' });
    intro.createEl('p', { text: '从一个好订阅开始，把阅读留给自己。' });
    const actions = header.createDiv('qrs-discovery-actions');
    actions.createEl('button', { text: '管理订阅' }).onclick = () => this.plugin.manageSubscriptions();
    actions.createEl('button', { text: '开始阅读', cls: 'mod-cta' }).onclick = () => { void this.plugin.readSubscriptions(); };
    page.createEl('p', { cls: 'qrs-discovery-standard', text: '编辑推荐 · 9 个。标准是长期原创、持续更新、RSS 全文与鲜明的个人辨识度，宁缺毋滥。' });
    const fieldId = crypto.randomUUID(); page.createEl('label', { cls: 'qrs-visually-hidden', text: '搜索订阅目录', attr: { for: `qrs-discovery-search-${fieldId}` } });
    const search = page.createEl('input', { type: 'search', cls: 'qrs-discovery-search', placeholder: '搜索名称、主题或语言…', attr: { id: `qrs-discovery-search-${fieldId}` } });
    addSearchClear(search);
    search.value = this.query; search.oninput = () => { this.query = search.value; this.refresh(); };
    const filters = page.createDiv({ cls: 'qrs-discovery-filters' });
    for (const category of categories) {
      const button = filters.createEl('button', { text: category, attr: { 'aria-pressed': String(this.category === category) } });
      button.onclick = () => {
        this.category = category;
        for (const item of filters.querySelectorAll('button')) item.setAttribute('aria-pressed', String(item === button));
        this.refresh();
      };
    }
    const provider = page.createDiv('qrs-discovery-provider');
    this.count = provider.createSpan({ cls: 'qrs-discovery-count', attr: { role: 'status' } });
    this.cards = page.createDiv('qrs-discovery-grid');
    this.refresh();
    page.createEl('p', { cls: 'qrs-discovery-footnote', text: '推荐信息保存在本地，点击订阅时才读取对应 RSS。公共源可能限流或失效；失败时可以重试。' });
    this.registerEvent(this.plugin.app.workspace.on('active-leaf-change', () => this.refresh()));
  }
  onunload() { this.closed = true; }
  refresh() {
    if (this.closed || !this.cards) return;
    // Preserve keyboard focus when a pending card finishes or another view updates.
    const active = this.contentEl.ownerDocument.activeElement;
    const focusedId = active instanceof HTMLElement && this.cards.contains(active) ? active.closest<HTMLElement>('[data-feed]')?.dataset.feed : undefined;
    this.cards.empty();
    const feeds = filterDiscovery(this.query, this.category);
    this.count.setText(`${feeds.length} / ${discoveryFeeds.length} 个推荐`);
    if (!feeds.length) this.cards.createDiv({ cls: 'qrs-empty', text: '没有找到匹配内容，试试其他关键词或分类。' });
    for (const feed of feeds) {
      const url = feed.url;
      const subscribed = this.plugin.state.subscriptions.some(item => item.url === url);
      const card = this.cards.createEl('article', { cls: 'qrs-discovery-card', attr: { 'data-feed': feed.id, tabindex: '-1' } });
      const heading = card.createDiv('qrs-discovery-card-heading');
      setIcon(heading.createSpan('qrs-discovery-icon'), feed.icon);
      heading.createEl('h2', { text: feed.name });
      card.createDiv({ cls: 'qrs-discovery-meta', text: `${feed.category} · ${feed.language}` });
      card.createEl('p', { text: feed.description });
      const footer = card.createDiv('qrs-discovery-card-footer');
      footer.createEl('a', { text: new URL(feed.site ?? url).hostname, href: feed.site ?? url, attr: { target: '_blank', rel: 'noopener noreferrer' } });
      const button = footer.createEl('button', { text: subscribed ? '已订阅' : this.pending.has(feed.id) ? '添加中…' : this.errors.has(feed.id) ? '重试' : '订阅' });
      button.disabled = subscribed || this.pending.has(feed.id);
      button.onclick = () => {
        if (this.pending.has(feed.id)) return;
        this.pending.add(feed.id); this.errors.delete(feed.id); this.refresh();
        void this.plugin.subscriptions.add(url, feed.category, this.contentEl.ownerDocument).then(async subscription => {
          await this.plugin.activateSubscription(subscription.id);
          new Notice(`已订阅 ${feed.name}`);
        }).catch((error: unknown) => {
          this.errors.set(feed.id, error instanceof Error ? error.message : '添加失败，请重试。');
        }).finally(() => { this.pending.delete(feed.id); this.refresh(); this.plugin.refreshDiscovery(); });
      };
      const error = this.errors.get(feed.id);
      if (error && !subscribed) card.createDiv({ cls: 'qrs-subscription-error', text: error, attr: { role: 'status' } });
    }
    if (focusedId) {
      const card = this.cards.querySelector<HTMLElement>(`[data-feed="${focusedId}"]`);
      (card?.querySelector<HTMLElement>('button:not(:disabled)') ?? card)?.focus({ preventScroll: true });
    }
  }
}

/** Restores existing workspace tabs; new exploration opens inside subscription management. */
export class DiscoveryView extends ItemView {
  private panel?: DiscoveryPanel;
  constructor(leaf: WorkspaceLeaf, private plugin: PersonalRssPlugin) { super(leaf); }
  getViewType() { return DISCOVERY_VIEW_TYPE; }
  getDisplayText() { return '探索订阅'; }
  getIcon() { return 'compass'; }
  onOpen(): Promise<void> { this.panel = new DiscoveryPanel(this.contentEl, this.plugin); this.addChild(this.panel); return Promise.resolve(); }
  refresh() { this.panel?.refresh(); }
}
