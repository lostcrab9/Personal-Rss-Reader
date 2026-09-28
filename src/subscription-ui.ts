import { Modal, Notice, Setting, setIcon } from 'obsidian';
import { DiscoveryPanel } from './discovery-view';
import type PersonalRssPlugin from './main';
import { exportOpml, MAX_SUBSCRIPTIONS, parseOpml, type FeedInput } from './feeds';
import type { Subscription } from './model';

export type SubscriptionTab = 'mine' | 'explore';
export class SubscriptionManager extends Modal {
  private list!: HTMLElement;
  private message!: HTMLElement;
  private discovery?: DiscoveryPanel;
  private body!: HTMLElement;
  constructor(private plugin: PersonalRssPlugin, private changed: () => void, private tab: SubscriptionTab = 'mine') { super(plugin.app); }
  onOpen() {
    this.setTitle('订阅管理'); this.modalEl.addClass('qrs-subscription-modal');
    const tabs = this.contentEl.createDiv({ cls: 'qrs-subscription-tabs', attr: { role: 'tablist' } });
    this.body = this.contentEl.createDiv({ cls: 'qrs-subscription-body', attr: { role: 'tabpanel', id: `qrs-sources-${crypto.randomUUID()}` } });
    const choices: [SubscriptionTab, string][] = [['mine', '我的订阅'], ['explore', '探索']];
    const select = (tab: SubscriptionTab) => {
      this.tab = tab;
      for (const button of tabs.querySelectorAll('button')) { const selected = button.dataset.tab === tab; button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1; }
      this.discovery?.unload(); this.discovery = undefined; this.body.empty();
      if (tab === 'mine') this.renderMine();
      else { this.discovery = new DiscoveryPanel(this.body.createDiv(), this.plugin, true); this.discovery.load(); }
    };
    for (const [tab, label] of choices) {
      const button = tabs.createEl('button', { text: label, attr: { role: 'tab', 'data-tab': tab, 'aria-controls': this.body.id } });
      button.onclick = () => select(tab);
      button.onkeydown = event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const index = choices.findIndex(([id]) => id === this.tab);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : choices.length - 1)) % choices.length;
        select(choices[next][0]); (tabs.children[next] as HTMLButtonElement).focus();
      };
    }
    select(this.tab);
  }
  onClose() { this.discovery?.unload(); this.contentEl.empty(); }
  refresh() { this.discovery?.refresh(); }
  private renderMine() {
    const form = this.body.createEl('form', { cls: 'qrs-subscription-add' });
    const fieldId = crypto.randomUUID();
    form.createEl('label', { cls: 'qrs-visually-hidden', text: 'RSS、Atom 或播客地址', attr: { for: `qrs-feed-${fieldId}` } });
    const url = form.createEl('input', { type: 'url', placeholder: 'https://example.com/feed.xml', attr: { id: `qrs-feed-${fieldId}`, required: '' } });
    form.createEl('label', { cls: 'qrs-visually-hidden', text: '订阅分组', attr: { for: `qrs-group-${fieldId}` } });
    const group = form.createEl('input', { type: 'text', placeholder: '分组（可选）', attr: { id: `qrs-group-${fieldId}`, maxlength: '100' } });
    const add = form.createEl('button', { text: '添加', type: 'submit', cls: 'mod-cta' });
    this.message = this.body.createDiv({ cls: 'qrs-subscription-message', attr: { role: 'status' } });
    form.onsubmit = event => {
      event.preventDefault(); add.disabled = true; this.message.setText('正在读取订阅源…');
      void this.plugin.subscriptions.add(url.value, group.value, this.contentEl.ownerDocument).then(() => {
        url.value = ''; this.message.setText('订阅已添加。'); this.renderList(); this.changed();
      }).catch((error: unknown) => { this.message.setText(error instanceof Error ? error.message : '添加失败，请重试。'); }).finally(() => { add.disabled = false; });
    };
    const tools = this.body.createDiv('qrs-subscription-tools');
    const importButton = tools.createEl('button', { text: '导入 OPML' });
    importButton.onclick = () => new OpmlImport(this.plugin, () => { this.renderList(); this.changed(); }).open();
    const exportButton = tools.createEl('button', { text: '导出 OPML' });
    exportButton.onclick = () => {
      if (!this.plugin.state.subscriptions.length) { this.message.setText('还没有可以导出的订阅。'); return; }
      void this.plugin.saveOpml(exportOpml(this.plugin.state.subscriptions)).then(path => {
        this.message.setText(`已导出到 ${path}`);
      }).catch(() => { this.message.setText('导出失败，请检查 OPML 导出文件夹。'); });
    };
    this.list = this.body.createDiv('qrs-subscription-list'); this.renderList();
    this.body.createEl('p', { cls: 'qrs-subscription-help', text: '文章与播客订阅仅保存在本库，并直接读取订阅源和媒体地址。AI 翻译仅在你手动触发时调用自备模型。' });
  }
  private renderList() {
    this.list.empty();
    const feeds = [...this.plugin.state.subscriptions].sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
    if (!feeds.length) { this.list.createDiv({ cls: 'qrs-empty', text: '添加第一个订阅，开始阅读。' }); return; }
    for (const feed of feeds) {
      const row = this.list.createDiv('qrs-subscription-row');
      const info = row.createDiv('qrs-subscription-info');
      info.createDiv({ cls: 'qrs-subscription-name', text: feed.name });
      const unit = feed.entries.some(entry => !!entry.audio) ? '集' : '篇';
      info.createDiv({ cls: 'qrs-subscription-detail', text: `${feed.group || '未分组'} · ${new URL(feed.url).hostname} · ${feed.entries.length} ${unit}` });
      if (feed.error) info.createDiv({ cls: 'qrs-subscription-error', text: feed.error });
      const edit = row.createEl('button', { cls: 'qrs-subscription-icon', attr: { 'data-qrs-label': `编辑 ${feed.name}` } });
      setIcon(edit, 'pencil'); edit.createSpan({ cls: 'qrs-visually-hidden', text: `编辑 ${feed.name}` });
      edit.onclick = () => new EditSubscription(this.plugin, feed, () => { this.renderList(); this.changed(); }).open();
      const remove = row.createEl('button', { cls: 'qrs-subscription-icon', attr: { 'data-qrs-label': `取消订阅 ${feed.name}` } });
      setIcon(remove, 'trash-2'); remove.createSpan({ cls: 'qrs-visually-hidden', text: `取消订阅 ${feed.name}` });
      remove.onclick = () => {
        edit.hidden = true; remove.hidden = true;
        const confirmation = row.createDiv('qrs-subscription-confirm');
        confirmation.createSpan({ text: `取消订阅 ${feed.name}？已收藏的文章会保留。` });
        const keep = confirmation.createEl('button', { text: '保留', type: 'button' });
        keep.onclick = () => { confirmation.remove(); edit.hidden = false; remove.hidden = false; remove.focus(); };
        const confirm = confirmation.createEl('button', { text: '取消订阅', type: 'button', cls: 'mod-warning' });
        confirm.onclick = async () => {
          keep.disabled = true; confirm.disabled = true;
          try { await this.plugin.subscriptions.remove(feed.id); this.renderList(); this.changed(); }
          catch (error) {
            this.message.setText(error instanceof Error ? error.message : '取消订阅失败，请重试。');
            keep.disabled = false; confirm.disabled = false;
          }
        };
        keep.focus();
      };
    }
  }
}
class EditSubscription extends Modal {
  constructor(private plugin: PersonalRssPlugin, private feed: Subscription, private changed: () => void) { super(plugin.app); }
  onOpen() {
    this.setTitle('编辑订阅'); this.modalEl.addClass('qrs-subscription-modal'); let name = this.feed.name; let group = this.feed.group;
    new Setting(this.contentEl).setName('名称').addText(text => text.setValue(name).onChange(value => { name = value; }));
    new Setting(this.contentEl).setName('分组').addText(text => text.setValue(group).setPlaceholder('未分组').onChange(value => { group = value; }));
    new Setting(this.contentEl).addButton(button => button.setButtonText('保存').setCta().onClick(async () => {
      try { await this.plugin.subscriptions.edit(this.feed.id, name, group); this.changed(); this.close(); }
      catch (error) { new Notice(error instanceof Error ? error.message : '保存失败。'); }
    }));
  }
}
class OpmlImport extends Modal {
  private feeds: FeedInput[] = [];
  constructor(private plugin: PersonalRssPlugin, private changed: () => void) { super(plugin.app); }
  onOpen() {
    this.setTitle('导入 OPML'); this.modalEl.addClass('qrs-subscription-modal');
    const fieldId = crypto.randomUUID();
    this.contentEl.createEl('label', { cls: 'qrs-visually-hidden', text: '选择 OPML 文件', attr: { for: `qrs-opml-file-${fieldId}` } });
    const input = this.contentEl.createEl('input', { type: 'file', attr: { id: `qrs-opml-file-${fieldId}`, accept: '.opml,.xml,text/xml,application/xml' } });
    this.contentEl.createEl('label', { cls: 'qrs-visually-hidden', text: 'OPML 内容', attr: { for: `qrs-opml-text-${fieldId}` } });
    const area = this.contentEl.createEl('textarea', { cls: 'qrs-opml-text', placeholder: '也可以粘贴 OPML 内容…', attr: { id: `qrs-opml-text-${fieldId}` } });
    const preview = this.contentEl.createDiv({ cls: 'qrs-opml-preview', attr: { role: 'status' } });
    const importButton = this.contentEl.createEl('button', { text: '导入订阅', cls: 'mod-cta' }); importButton.disabled = true;
    const validate = () => {
      this.feeds = []; importButton.disabled = true; preview.empty();
      try {
        const parsed = parseOpml(area.value, this.contentEl.ownerDocument);
        const existing = new Set(this.plugin.state.subscriptions.map(feed => feed.url));
        this.feeds = parsed.feeds.filter(feed => !existing.has(feed.url));
        preview.createEl('p', { text: `新增 ${this.feeds.length} 个订阅，跳过 ${parsed.skipped + parsed.feeds.length - this.feeds.length} 个重复或无效地址。` });
        if (this.feeds.length + existing.size > MAX_SUBSCRIPTIONS) throw new Error(`最多保留 ${MAX_SUBSCRIPTIONS} 个订阅，请减少导入数量。`);
        for (const feed of this.feeds.slice(0, 10)) preview.createDiv({ text: `${feed.group ? feed.group + ' / ' : ''}${feed.name}` });
        if (this.feeds.length > 10) preview.createDiv({ text: `另有 ${this.feeds.length - 10} 个订阅` });
        importButton.disabled = !this.feeds.length;
      } catch (error) { preview.setText(error instanceof Error ? error.message : '文件无法读取。'); }
    };
    area.oninput = validate;
    input.onchange = () => {
      this.feeds = []; importButton.disabled = true;
      const file = input.files?.[0]; if (!file) return;
      if (file.size > 5 * 1024 * 1024) { preview.setText('OPML 文件超过 5 MB。'); return; }
      void file.text().then(value => { area.value = value; validate(); }).catch(() => { preview.setText('文件无法读取。'); });
    };
    this.contentEl.createEl('p', { cls: 'qrs-subscription-help', text: '导入后在“我的订阅”点击刷新获取文章。导入不会覆盖现有订阅的名称和分组。' });
    importButton.onclick = () => {
      importButton.disabled = true;
      void this.plugin.subscriptions.import(this.feeds).then(count => {
        new Notice(`已导入 ${count} 个订阅。`); this.changed(); this.close();
      }).catch((error: unknown) => { preview.setText(error instanceof Error ? error.message : '导入失败。'); importButton.disabled = false; });
    };
  }
}
