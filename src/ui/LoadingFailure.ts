import { titleMenuNav } from './MenuNavigator.ts';

/** Recoverable loading failure; callbacks retain ownership of navigation. */
export function showLoadingFailure(parent: HTMLElement, error: unknown, onMenu: () => void): void {
  const message = error instanceof Error ? error.message : String(error);
  const graphics = /webgl|graphics|rendering context|engine.*initializ/i.test(message);
  parent.classList.add('error');
  parent.style.pointerEvents = 'auto';
  parent.setAttribute('role', 'alertdialog');
  parent.setAttribute('aria-modal', 'true');
  parent.setAttribute('aria-labelledby', 'load-failure-title');
  parent.setAttribute('aria-describedby', 'load-failure-detail');
  const title = document.createElement('h2');
  title.id = 'load-failure-title'; title.className = 'boot-title';
  title.textContent = graphics ? '3D graphics unavailable' : 'The heist couldn’t load';
  const detail = document.createElement('p');
  detail.id = 'load-failure-detail'; detail.className = 'panel__body';
  detail.textContent = graphics
    ? 'Enable hardware acceleration in your browser, or try another browser to fly PIX and NEE.'
    : 'Check your connection, then return to the menu and try again.';
  const back = document.createElement('button');
  back.type = 'button'; back.className = 'btn btn--primary'; back.textContent = 'Back to menu';
  const leave = () => { titleMenuNav.detach(); onMenu(); };
  back.addEventListener('click', leave);
  parent.replaceChildren(title, detail, back);
  titleMenuNav.attach(parent, { onBack: leave, initialFocus: back });
}
