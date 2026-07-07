/**
 * 设置 popup（点工具栏图标弹出，也注册为 options 页），React 渲染。
 * 只暴露两项：relay 地址、是否在 X 文章页显示上传按钮；其余（token/queryId）走内置默认。
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_RELAY_BASE } from './xsession.js';
import { useRelaySettings } from './use-relay-settings.js';
import { HelpIcon, LogoIcon } from './icons.js';

function SettingsPage() {
  const s = useRelaySettings();
  const [helpOpen, setHelpOpen] = useState(false);

  // 回填完真实值再显示页面（CSS 以 body.kx-ready 控制），避免默认开关状态先闪一下。
  useEffect(() => {
    if (s.ready) document.body.classList.add('kx-ready');
  }, [s.ready]);

  return (
    <div className="kx-page">
      <header className="kx-topbar">
        <span className="kx-topbar-title">
          <LogoIcon size={24} />
          设置
        </span>
        <span className="kx-topbar-right">
          <span className={`kx-pill kx-pill-${s.pill.state}`}>
            <span className="kx-dot" />
            <span>{s.pill.text}</span>
          </span>
          <button className="kx-help" type="button" title="帮助" aria-label="帮助" onClick={() => setHelpOpen((v) => !v)}>
            <HelpIcon size={18} />
          </button>
        </span>
      </header>

      {helpOpen && (
        <div className="kx-help-box">
          在终端运行 <code>kaitox relay</code> 启动本地中继，用 <code>kaitox x push</code> 或 Obsidian
          推送草稿，然后打开 x.com/compose/articles 点「上传草稿」。
        </div>
      )}

      <p className="kx-section-title">中继</p>
      <section className="kx-card">
        <div className="kx-field">
          <label htmlFor="kx-relay-base">Relay 地址</label>
          <input
            id="kx-relay-base"
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
      </section>

      <p className="kx-section-title">X 设置</p>
      <section className="kx-card">
        <div className="kx-row-between kx-row-toggle">
          <span className="kx-label">在文章草稿页显示上传按钮</span>
          <button
            className="kx-toggle"
            type="button"
            role="switch"
            aria-checked={s.showButton}
            aria-label="在文章草稿页显示上传按钮"
            onClick={() => void s.flipShowButton()}
          >
            <span className="kx-knob" />
          </button>
        </div>
      </section>
    </div>
  );
}

createRoot(document.getElementById('kx-root')!).render(<SettingsPage />);
