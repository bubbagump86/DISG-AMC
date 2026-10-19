/**
 * A minimal DOM shim, enough to execute the dashboard's own script in Node.
 *
 * There is no jsdom available (the npm registry is unreachable here) and no
 * browser, so this stands in for one. It is deliberately forgiving:
 * `getElementById` materialises a stub for *any* id, so every render function
 * finds an element to write into. `innerHTML` is recorded rather than parsed,
 * which is all the smoke test needs to assert on.
 *
 * The important property: it records `console.error`, because the app funnels
 * every render through a `safeCall` helper that swallows failures into
 * `console.error`. A silent render failure therefore shows up as a failed test.
 */

class ClassList {
  constructor() {
    this.set = new Set();
  }
  add(...names) {
    for (const name of names) this.set.add(name);
  }
  remove(...names) {
    for (const name of names) this.set.delete(name);
  }
  contains(name) {
    return this.set.has(name);
  }
  toggle(name, force) {
    const on = force === undefined ? !this.set.has(name) : Boolean(force);
    if (on) this.set.add(name);
    else this.set.delete(name);
    return on;
  }
  get value() {
    return [...this.set].join(' ');
  }
}

let elementSeq = 0;

class Element {
  constructor(tagName, id) {
    this.tagName = (tagName || 'div').toUpperCase();
    this.id = id || '';
    this.nodeType = 1;
    this._innerHTML = '';
    this._textContent = '';
    this._attrs = new Map();
    this._listeners = new Map();
    this.classList = new ClassList();
    this.dataset = {};
    this.style = {};
    this.children = [];
    this.parentNode = null;
    this._seq = ++elementSeq;
  }

  get innerHTML() {
    return this._innerHTML;
  }
  set innerHTML(value) {
    this._innerHTML = String(value ?? '');
    // A real parser would create children; nothing here depends on them.
    this.children = [];
  }

  get outerHTML() {
    return this._innerHTML;
  }

  get textContent() {
    return this._textContent;
  }
  set textContent(value) {
    this._textContent = String(value ?? '');
  }

  getAttribute(name) {
    return this._attrs.has(name) ? this._attrs.get(name) : null;
  }
  setAttribute(name, value) {
    this._attrs.set(name, String(value));
  }
  removeAttribute(name) {
    this._attrs.delete(name);
  }
  hasAttribute(name) {
    return this._attrs.has(name);
  }

  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(handler);
  }
  removeEventListener(type, handler) {
    const list = this._listeners.get(type);
    if (!list) return;
    const index = list.indexOf(handler);
    if (index >= 0) list.splice(index, 1);
  }
  dispatch(type, event = {}) {
    for (const handler of this._listeners.get(type) || []) handler({ target: this, ...event });
  }
  hasListener(type) {
    return (this._listeners.get(type) || []).length > 0;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    return child;
  }
  insertBefore(child) {
    return this.appendChild(child);
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  insertAdjacentHTML(position, html) {
    this._innerHTML += String(html ?? '');
  }
  closest() {
    return null;
  }
  getBoundingClientRect() {
    return { top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100, x: 0, y: 0 };
  }
  getBoundingClientRectList() {
    return [];
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  getElementsByTagName() {
    return [];
  }
  focus() {
    // Tracked so the app's focus-restore logic (modal open/close) is observable
    // and does not simply throw on a missing activeElement.
    Element.activeElement = this;
  }
  blur() {
    if (Element.activeElement === this) Element.activeElement = null;
  }
  click() {
    this.dispatch('click');
  }
  scrollIntoView() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  setAttributeNS() {}
  get firstChild() {
    return this.children[0] || null;
  }
  get lastChild() {
    return this.children[this.children.length - 1] || null;
  }
  get nextSibling() {
    return null;
  }
  get offsetWidth() {
    return 100;
  }
  get offsetHeight() {
    return 100;
  }
  get clientWidth() {
    return 100;
  }
  get clientHeight() {
    return 100;
  }
  get scrollTop() {
    return 0;
  }
  set scrollTop(_value) {}
}

class Document {
  constructor() {
    this._byId = new Map();
    this.documentElement = new Element('html');
    this.documentElement.setAttribute('data-theme', 'dark');
    this.head = new Element('head');
    this.body = new Element('body');
    this._listeners = new Map();
    this.readyState = 'complete';
  }

  getElementById(id) {
    if (!this._byId.has(id)) {
      this._byId.set(id, new Element('div', id));
    }
    return this._byId.get(id);
  }

  /** Last element focused, or the body when nothing has been focused. */
  get activeElement() {
    return Element.activeElement || this.body;
  }

  createElement(tag) {
    return new Element(tag);
  }
  createElementNS(_ns, tag) {
    return new Element(tag);
  }
  createDocumentFragment() {
    return new Element('fragment');
  }
  createTextNode(text) {
    const node = new Element('text');
    node.textContent = text;
    return node;
  }

  querySelector(selector) {
    // Return a stub for id selectors so callers can still attach handlers.
    if (typeof selector === 'string' && selector.startsWith('#')) {
      return this.getElementById(selector.slice(1));
    }
    return null;
  }
  querySelectorAll() {
    return [];
  }
  getElementsByTagName() {
    return [];
  }
  getElementsByClassName() {
    return [];
  }

  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(handler);
  }
  removeEventListener() {}
  dispatch(type, event = {}) {
    for (const handler of this._listeners.get(type) || []) handler(event);
  }
  hasListener(type) {
    return (this._listeners.get(type) || []).length > 0;
  }
  write() {}
}

class Storage {
  constructor() {
    this._map = new Map();
  }
  getItem(key) {
    return this._map.has(key) ? this._map.get(key) : null;
  }
  setItem(key, value) {
    this._map.set(key, String(value));
  }
  removeItem(key) {
    this._map.delete(key);
  }
  clear() {
    this._map.clear();
  }
}

/**
 * Build an isolated browser-ish environment.
 *
 * @param {object} options
 * @param {number} options.width viewport width reported by matchMedia
 * @returns {{window: object, document: Document, errors: string[], warns: string[],
 *            logs: string[], fetchCalls: string[], elements: Map<string, Element>}}
 */
export function createDom({ width = 1440 } = {}) {
  const document = new Document();
  const errors = [];
  const warns = [];
  const logs = [];
  const fetchCalls = [];

  const localStorage = new Storage();
  const sessionStorage = new Storage();

  const matchMedia = (query) => {
    const isNarrow = /max-width:\s*(\d+)px/.exec(query);
    const isWide = /min-width:\s*(\d+)px/.exec(query);
    let matches = false;
    if (isNarrow) matches = width <= Number(isNarrow[1]);
    else if (isWide) matches = width >= Number(isWide[1]);
    return {
      media: query,
      matches,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    };
  };

  // A real event target, because the router listens for hashchange.
  const windowListeners = new Map();
  const windowEvents = {
    addEventListener(type, handler) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      const list = windowListeners.get(type);
      if (!list) return;
      const index = list.indexOf(handler);
      if (index >= 0) list.splice(index, 1);
    },
    dispatch(type, event = {}) {
      for (const handler of windowListeners.get(type) || []) handler(event);
    },
    hasListener(type) {
      return (windowListeners.get(type) || []).length > 0;
    },
  };

  let currentHash = '';
  const location = {
    href: 'http://localhost/',
    origin: 'http://localhost',
    protocol: 'http:',
    host: 'localhost',
    pathname: '/',
    search: '',
    get hash() {
      return currentHash;
    },
    set hash(value) {
      const next = String(value).startsWith('#') ? String(value) : `#${value}`;
      if (next === currentHash) return;
      const previous = currentHash;
      currentHash = next;
      this.href = `http://localhost/${next}`;
      windowEvents.dispatch('hashchange', { oldURL: `http://localhost/${previous}`, newURL: this.href });
    },
    reload() {},
    assign() {},
    replace() {},
    toString() {
      return 'http://localhost/';
    },
  };

  const window = {
    document,
    localStorage,
    sessionStorage,
    matchMedia,
    location,
    innerWidth: width,
    innerHeight: 900,
    devicePixelRatio: 1,
    scrollY: 0,
    pageYOffset: 0,
    addEventListener: windowEvents.addEventListener,
    removeEventListener: windowEvents.removeEventListener,
    dispatchEvent(event) {
      windowEvents.dispatch(event && event.type, event);
      return true;
    },
    dispatch(type, event) {
      windowEvents.dispatch(type, event);
    },
    hasListener: windowEvents.hasListener,
    requestAnimationFrame(callback) {
      return setTimeout(() => callback(Date.now()), 0);
    },
    cancelAnimationFrame(id) {
      clearTimeout(id);
    },
    getComputedStyle() {
      return { getPropertyValue: () => '' };
    },
    scrollTo() {},
    open() {
      return null;
    },
    print() {},
  };
  window.window = window;
  window.self = window;
  window.globalThis = window;

  const consoleShim = {
    log: (...args) => logs.push(args.map(String).join(' ')),
    info: (...args) => logs.push(args.map(String).join(' ')),
    debug: (...args) => logs.push(args.map(String).join(' ')),
    warn: (...args) => warns.push(args.map(String).join(' ')),
    // The dashboard routes every render through safeCall, which reports
    // failures here. Treat any of these as a test failure.
    error: (...args) => errors.push(args.map(String).join(' ')),
  };

  return {
    window,
    document,
    location,
    localStorage,
    sessionStorage,
    matchMedia,
    console: consoleShim,
    errors,
    warns,
    logs,
    fetchCalls,
    elements: document._byId,
    dispatchWindow: windowEvents.dispatch,
    Element,
  };
}
