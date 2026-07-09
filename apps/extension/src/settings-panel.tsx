/**
 * 设置浮窗：点插件工具栏图标（或草稿弹窗底部「设置」）后，
 * React 渲染；root 懒创建、全页单例。开关走三态：open → closing（播滑出动画）→ closed。
 */
import { useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DEFAULT_RELAY_BASE } from './xsession.js';
import { useRelaySettings } from './use-relay-settings.js';
import { CloseIcon, HelpIcon, LogoIcon } from './icons.js';
import { KX_CLOSE_MS } from './use-closing.js';

const PANEL_ID = 'kaitox-settings';

type PanelState = 'open' | 'closing' | 'closed';

function SettingsPanelApp({ state, onClose }: { state: PanelState; onClose: () => void }) {
  const s = useRelaySettings(state === 'open');
  const [helpOpen, setHelpOpen] = useState(false);

  // 先读完存储值再显示，避免默认状态先渲染出来又被纠正（开关闪动）。
  // closing 期间 s.ready 保持上次的 true，面板留在原地播滑出动画。
  if (state === 'closed' || !s.ready) return null;

  return (
    <div id={PANEL_ID} className={state === 'closing' ? 'kx-closing' : undefined}>
      <div className="kx-set-topbar">
        <span className="kx-set-title">
          <LogoIcon size={24} />
          设置
        </span>
        <span className="kx-set-topbar-right">
          <span className={`kx-set-pill kx-set-pill-${s.pill.state}`}>
            <span className="kx-set-dot" />
            <span>{s.pill.text}</span>
          </span>
          <button className="kx-icon-btn" title="帮助" type="button" onClick={() => setHelpOpen((v) => !v)}>
            <HelpIcon />
          </button>
          <button className="kx-icon-btn" title="关闭" type="button" onClick={onClose}>
            <CloseIcon />
          </button>
        </span>
      </div>

      {helpOpen && (
        <div className="kx-set-help">
          在终端运行 kaitox relay 启动本地中继，用 kaitox x push 或 Obsidian 推送草稿，然后在本页点「上传草稿」。
        </div>
      )}

      <p className="kx-set-section">中继</p>
      <div className="kx-set-card">
        <div className="kx-set-field">
          <label>Relay 地址</label>
          <input
            className="kx-set-input"
            type="text"
            spellCheck={false}
            placeholder={DEFAULT_RELAY_BASE}
            value={s.relayBase}
            onChange={(e) => s.setRelayBase(e.target.value)}
            onBlur={() => void s.commitRelayBase()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void s.commitRelayBase();
            }}
          />
        </div>
      </div>

      <p className="kx-set-section">X 设置</p>
      <div className="kx-set-card">
        <div className="kx-set-row kx-set-row-toggle">
          <span className="kx-set-label">在文章草稿页显示上传按钮</span>
          <button
            className="kx-set-toggle"
            type="button"
            role="switch"
            aria-checked={s.showButton}
            aria-label="在文章草稿页显示上传按钮"
            onClick={() => void s.flipShowButton()}
          >
            <span className="kx-set-knob" />
          </button>
        </div>
      </div>
    </div>
  );
}

let root: Root | null = null;
let host: HTMLElement | null = null;
let state: PanelState = 'closed';
let closeTimer: number | undefined;

function render(): void {
  if (!host) host = document.createElement('div');
  if (!host.isConnected) document.body.append(host);
  if (!root) root = createRoot(host);
  root.render(<SettingsPanelApp state={state} onClose={() => toggleSettingsPanel(false)} />);
}

/** 打开/关闭右侧设置浮窗（懒创建，全页单例；关闭先播滑出动画再卸载）。 */
export function toggleSettingsPanel(force?: boolean): void {
  const show = force ?? state !== 'open';
  window.clearTimeout(closeTimer);
  closeTimer = undefined;
  if (show) {
    state = 'open';
  } else if (state === 'open') {
    state = 'closing';
    closeTimer = window.setTimeout(() => {
      closeTimer = undefined;
      state = 'closed';
      render();
    }, KX_CLOSE_MS);
  } else {
    state = 'closed';
  }
  render();
}
