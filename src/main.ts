import { Notice, Plugin, PluginSettingTab, Setting, type App } from 'obsidian';
import { folderPath, initialState, modeLabels, modeSchema, readingFontSchema, type Bundle, type State } from './model';
import { ReaderView, VIEW_TYPE } from './view';
import { readingFonts, selectableFonts, ReadingFonts } from './fonts';
import { LocalImages } from './images';
import { Subscriptions } from './subscriptions';
import { SubscriptionManager, type SubscriptionTab } from './subscription-ui';
import { DiscoveryView, DISCOVERY_VIEW_TYPE } from './discovery-view';
import { TranslationService } from './translation/service';
import { TranslationStore } from './translation/store';
import { TranslationController } from './translation/controller';
import { WebArticles } from './web-articles';

export default class PersonalRssPlugin extends Plugin {
  fonts = new ReadingFonts();
  state: State = initialState(null);
  images!: LocalImages;
  subscriptions!: Subscriptions;
  webArticles = new WebArticles();
  translationService = new TranslationService();
  translationStore!: TranslationStore;
  translationController!: TranslationController;
  private subscriptionManager?: SubscriptionManager;
  private settingsTab?: RssSettings;
  private saving: Promise<void> = Promise.resolve();

  async onload() {
    try { this.state = initialState(await this.loadData()); }
    catch { new Notice('RSS 配置不兼容，已使用默认设置。'); }
    this.images = new LocalImages(this.app.vault, `${this.app.vault.configDir}/plugins/${this.manifest.id}/image-cache`);
    this.subscriptions = new Subscriptions(() => this.state, () => this.persist());
    this.translationStore = new TranslationStore(() => this.state, () => this.persist());
    this.translationController = new TranslationController(this.translationService, this.translationStore);
    this.registerView(VIEW_TYPE, leaf => new ReaderView(leaf, this));
    this.registerView(DISCOVERY_VIEW_TYPE, leaf => new DiscoveryView(leaf, this));
    this.addCommand({ id: 'manage-subscriptions', name: '管理我的订阅', callback: () => this.manageSubscriptions() });
    this.addCommand({ id: 'explore-subscriptions', name: '探索订阅', callback: () => { void this.openDiscovery(); } });
    this.addRibbonIcon('rss', '打开个人 RSS 阅读器', () => { void this.openReader(); });
    this.addCommand({ id: 'open-reader', name: '打开个人 RSS 阅读器', callback: () => { void this.openReader(); } });
    this.settingsTab = new RssSettings(this.app, this); this.addSettingTab(this.settingsTab);
  }
  onunload() { this.fonts.dispose(); }
  async openReader() {
    try {
      let leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
      if (!leaf) { leaf = this.app.workspace.getLeaf('tab'); await leaf.setViewState({ type: VIEW_TYPE, active: true }); }
      await leaf.loadIfDeferred(); await this.app.workspace.revealLeaf(leaf);
    } catch { new Notice('无法打开 RSS 阅读器。'); }
  }
  persist(): Promise<void> { this.saving = this.saving.catch(() => undefined).then(() => this.saveData(this.state)); return this.saving; }
  remember(bundle: Bundle) {
    if (bundle.entry.origin !== 'local') return;
    this.state.cache[bundle.entry.id] = bundle;
    const recent = Object.values(this.state.cache).sort((a, b) => b.fetchedAt - a.fetchedAt).slice(0, 40);
    this.state.cache = Object.fromEntries(recent.map(value => [value.entry.id, value]));
    if (this.state.favorites[bundle.entry.id]) this.state.favorites[bundle.entry.id] = bundle;
  }
  openSettings(section?: '阅读' | '来源' | 'AI 翻译' | '关于') {
    if (section) this.settingsTab?.selectSection(section);
    const app = this.app as App & { setting: { open(): void; openTabById(id: string): void } };
    app.setting.open(); app.setting.openTabById(this.manifest.id);
  }
  manageSubscriptions(tab: SubscriptionTab = 'mine') {
    this.subscriptionManager?.close();
    this.subscriptionManager = new SubscriptionManager(this, () => {
      this.refreshDiscovery(); for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof ReaderView) leaf.view.showSubscriptions();
    }, tab); this.subscriptionManager.open();
  }
  openDiscovery(): Promise<void> { this.manageSubscriptions('explore'); return Promise.resolve(); }
  refreshDiscovery() {
    this.subscriptionManager?.refresh();
    for (const leaf of this.app.workspace.getLeavesOfType(DISCOVERY_VIEW_TYPE)) if (leaf.view instanceof DiscoveryView) leaf.view.refresh();
  }
  async activateSubscription(id: string) {
    if (!this.state.subscriptions.some(feed => feed.id === id)) return;
    this.state.settings.lastSource = id; await this.persist();
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof ReaderView) leaf.view.showSubscription(id);
  }
  async readSubscriptions() {
    await this.openReader(); const view = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0]?.view;
    if (view instanceof ReaderView) view.showSubscriptions();
  }
  async saveOpml(content: string): Promise<string> {
    const folder = folderPath(this.state.settings.folder); let current = '';
    for (const segment of folder.split('/')) {
      current = current ? `${current}/${segment}` : segment;
      if (!this.app.vault.getAbstractFileByPath(current)) {
        try { await this.app.vault.createFolder(current); }
        catch (error) { if (!this.app.vault.getAbstractFileByPath(current)) throw error; }
      }
    }
    const path = `${folder}/subscriptions-${Date.now()}.opml`; await this.app.vault.create(path, content); return path;
  }
  refreshPreferences() { for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof ReaderView) leaf.view.refreshPreferences(); }
  resetViews() { for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof ReaderView) leaf.view.reset(); }
}

type Section = '阅读' | '来源' | 'AI 翻译' | '关于';
class RssSettings extends PluginSettingTab {
  private section: Section = '阅读';
  constructor(app: App, private plugin: PersonalRssPlugin) { super(app, plugin); }
  selectSection(section: Section) { this.section = section; if (this.containerEl.isConnected) this.display(); }
  display() {
    const { containerEl } = this; containerEl.empty();
    new Setting(containerEl).setName('个人 RSS 阅读器').setHeading();
    const nav = containerEl.createDiv({ cls: 'qrs-settings-tabs', attr: { role: 'tablist' } });
    for (const section of ['阅读', '来源', 'AI 翻译', '关于'] as const) {
      const button = nav.createEl('button', { text: section, attr: { role: 'tab', 'aria-selected': String(this.section === section) } });
      button.onclick = () => { this.section = section; this.display(); };
    }
    if (this.section === '阅读') this.renderReading();
    else if (this.section === '来源') this.renderSources();
    else if (this.section === 'AI 翻译') this.renderTranslation();
    else this.renderAbout();
  }
  private renderReading() {
    const settings = this.plugin.state.settings, save = async () => { this.plugin.refreshPreferences(); await this.plugin.persist(); };
    new Setting(this.containerEl).setName('正文字体').addDropdown(drop => {
      for (const font of selectableFonts.concat(readingFonts.filter(item => item.id === settings.fontFamily && !selectableFonts.includes(item)))) drop.addOption(font.id, font.name);
      drop.setValue(settings.fontFamily).onChange(async value => { settings.fontFamily = readingFontSchema.parse(value); await save(); this.display(); });
    });
    if (settings.fontFamily === 'custom') new Setting(this.containerEl).setName('设备字体名称').setDesc('其他设备没有此字体时使用系统衬线字体。').addText(text => text.setValue(settings.customFont).onChange(async value => { settings.customFont = value.slice(0, 200); await save(); }));
    new Setting(this.containerEl).setName('正文字号').addDropdown(drop => { for (let size = 14; size <= 32; size++) drop.addOption(String(size), `${size} px`); drop.setValue(String(settings.fontSize)).onChange(async value => { settings.fontSize = Number(value); await save(); }); });
    new Setting(this.containerEl).setName('正文行距').addDropdown(drop => { for (let value = 15; value <= 24; value++) drop.addOption((value / 10).toFixed(1), `${(value / 10).toFixed(1)} 倍`); drop.setValue(settings.lineHeight.toFixed(1)).onChange(async value => { settings.lineHeight = Number(value); await save(); }); });
    new Setting(this.containerEl).setName('正文宽度').addDropdown(drop => { for (const value of [28, 36, 44]) drop.addOption(String(value), `${value} 字`); drop.setValue(String(settings.lineWidth)).onChange(async value => { settings.lineWidth = Number(value) as 28 | 36 | 44; await save(); }); });
    new Setting(this.containerEl).setName('显示文章图片').setDesc('正文与缩略图缓存到插件目录，最多 64 MB。').addToggle(toggle => toggle.setValue(settings.remoteImages).onChange(async value => { settings.remoteImages = value; await this.plugin.persist(); this.plugin.resetViews(); }));
    new Setting(this.containerEl).setName('自动获取网页全文').setDesc('默认关闭。打开正文较短的文章时额外请求其网页，成功后缓存正文；目标网站会收到你的网络请求。').addToggle(toggle => toggle.setValue(settings.webFullText).onChange(async value => { settings.webFullText = value; await this.plugin.persist(); }));
  }
  private renderSources() {
    const settings = this.plugin.state.settings;
    new Setting(this.containerEl).setName('我的订阅').setDesc('添加文章或播客 RSS、探索推荐、分组与 OPML 导入导出。').addButton(button => button.setButtonText('管理订阅').onClick(() => this.plugin.manageSubscriptions()));
    new Setting(this.containerEl).setName('探索').setDesc('浏览离线内置的 9 个编辑推荐；点击订阅时才请求对应 RSS。').addButton(button => button.setButtonText('打开探索').onClick(() => this.plugin.manageSubscriptions('explore')));
    let pending = settings.folder;
    new Setting(this.containerEl).setName('OPML 导出文件夹').setDesc('导出的 OPML 文件保存在当前库的这个文件夹。').addText(text => text.setValue(settings.folder).onChange(value => { pending = value; })).addButton(button => button.setButtonText('保存').onClick(async () => {
      try { settings.folder = folderPath(pending); await this.plugin.persist(); new Notice('文件夹已保存。'); }
      catch (error) { new Notice(error instanceof Error ? error.message : '无法保存设置。'); }
    }));
  }
  private renderTranslation() {
    const config = this.plugin.state.settings.translationConfig;
    new Setting(this.containerEl).setName('启用 AI 翻译').setDesc('只有测试连接或手动生成译文时才会请求模型服务。').addToggle(toggle => toggle.setValue(config.enabled).onChange(async value => { config.enabled = value; await this.plugin.persist(); }));
    new Setting(this.containerEl).setName('API Base URL').setDesc('使用 OpenAI-compatible chat/completions；必须为 HTTPS，本机地址可用 HTTP。').addText(text => text.setPlaceholder('https://api.example.com/v1').setValue(config.baseUrl).onChange(async value => { config.baseUrl = value.trim(); await this.plugin.persist(); }));
    new Setting(this.containerEl).setName('API Key').setDesc('以明文保存在本机 data.json；同步 .obsidian 时可能随同步工具上传。').addText(text => { text.inputEl.type = 'password'; text.setValue(config.apiKey).onChange(async value => { config.apiKey = value; await this.plugin.persist(); }); });
    new Setting(this.containerEl).setName('模型').addText(text => text.setPlaceholder('gpt-4.1-mini').setValue(config.model).onChange(async value => { config.model = value.trim(); await this.plugin.persist(); }));
    new Setting(this.containerEl).setName('目标语言').addText(text => text.setValue(config.targetLanguage).onChange(async value => { config.targetLanguage = value.trim() || '简体中文'; await this.plugin.persist(); }));
    new Setting(this.containerEl).setName('默认显示方式').addDropdown(drop => { for (const mode of ['bilingual', 'translated', 'original'] as const) drop.addOption(mode, modeLabels[mode]); drop.setValue(config.defaultMode).onChange(async value => { config.defaultMode = modeSchema.parse(value); await this.plugin.persist(); }); });
    new Setting(this.containerEl).setName('测试连接').setDesc('仅发送“Hello”，不会发送文章、订阅或阅读数据。').addButton(button => button.setButtonText('测试').onClick(async () => {
      button.setDisabled(true); try { const host = await this.plugin.translationService.test(config); new Notice(`连接成功：${host}`); }
      catch (error) { new Notice(error instanceof Error ? error.message : '连接失败。'); } finally { button.setDisabled(false); }
    }));
    new Setting(this.containerEl).setName('翻译缓存').setDesc(`${Object.keys(this.plugin.state.translationArtifacts).length} 篇文章；译文和翻译记忆均保存在本库插件数据。`).addButton(button => button.setButtonText('清除全部').setDestructive().onClick(async () => { await this.plugin.translationStore.clearAll(); new Notice('翻译缓存已清除。'); this.display(); }));
    this.containerEl.createEl('p', { cls: 'setting-item-description', text: '正文仅直接发送到你配置的服务。本项目不收集 API Key、正文、译文、用量或阅读行为。移动端无法直接访问桌面电脑的 localhost。' });
  }
  private renderAbout() {
    new Setting(this.containerEl).setName(`当前版本 ${this.plugin.manifest.version}`).setDesc('个人 RSS 阅读器，基于 qiaomu-ai-rss 修改。');
    new Setting(this.containerEl).setName('开源许可').setDesc('Copyright © 向阳乔木及贡献者 · GPL-3.0-only。内置朱雀仿宋遵循 SIL OFL 1.1。');
  }
}
