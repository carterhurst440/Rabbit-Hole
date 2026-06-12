// rabbit-hole-signin.js
// Drop-in Web Component for the RABBIT HOLE sign-in screen + transition.
// EXACT port of the prototype (same SVG paths, same timeline, same easings) so
// there is NOTHING to reinterpret — mount it and wire one event.
//
//   <rabbit-hole-signin></rabbit-hole-signin>
//
// Fires a `signin` CustomEvent at the end of the transition (after the fade to
// black). Route to your post-auth page in that handler:
//
//   el.addEventListener('signin', (e) => { router.push('/home'); });
//
// In a real app, DON'T let the animation be the auth. Intercept the button via
// the `submit` event (fired the instant SIGN IN is pressed), run your auth
// request, and only call el.play() on success (or el.fail() to abort). See the
// `autoplay` attribute + methods below.
//
// Attributes:
//   email="you@warren.ink"   prefill the (display-only) email line
//   autoplay                 if present, pressing SIGN IN plays the transition
//                            immediately (demo mode). Omit to gate on auth:
//                            listen for `submit`, then call play().
//
// Methods:  play()  reset()  (replay)   ·   Events: `submit`, `signin`
//
// Honors prefers-reduced-motion (skips straight to the `signin` event).

(function () {
  const TPL = document.createElement('template');
  TPL.innerHTML = `
<style>
  :host{
    --bg:#0a0908; --ink:#f2ead4; --accent:#e3a869; --dim:#7a7158;
    display:block; position:relative; width:100%; height:100%; min-height:520px;
    background:var(--bg); overflow:hidden;
    font-family:"JetBrains Mono", ui-monospace, monospace;
  }
  svg.scene{position:absolute;inset:0;width:100%;height:100%;display:block;}
  .ln{fill:none;stroke:var(--ink);stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;
      stroke-dasharray:1;stroke-dashoffset:1;}
  .ln.acc{stroke:var(--accent);} .ln.thin{stroke-width:1.5;}
  .tx{fill:var(--ink);opacity:0;font-weight:700;text-anchor:middle;dominant-baseline:middle;}
  .tx.dim{fill:var(--dim);} .tx.acc{fill:var(--accent);} .tx.l{text-anchor:start;}
  .ear{transform-box:fill-box;transform-origin:50% 100%;}
  .peeking .earB{animation:earB 2.4s ease-in-out infinite;}
  .peeking .earF{animation:earF 2.4s ease-in-out infinite;}
  @keyframes earB{0%,100%{transform:rotate(2deg);}50%{transform:rotate(-8deg);}}
  @keyframes earF{0%,100%{transform:rotate(-3deg);}50%{transform:rotate(7deg);}}
  #signinBtn{cursor:pointer;}
  .black{position:absolute;inset:0;background:var(--bg);opacity:0;pointer-events:none;
    transition:opacity .55s ease;}
  @media(prefers-reduced-motion:reduce){ .peeking .ear{animation:none;} }
</style>
<svg class="scene" part="scene" preserveAspectRatio="xMinYMin slice">
  <defs><clipPath id="band"><rect id="clipTop"/><rect id="clipBot"/></clipPath></defs>
  <g id="login"><g id="holes"></g><g id="cardBody"></g></g>
  <g clip-path="url(#band)"><g id="rabbit"></g></g>
</svg>
<div class="black" id="black"></div>`;

  class RabbitHoleSignin extends HTMLElement {
    static get observedAttributes() { return ['email']; }

    connectedCallback() {
      if (this._wired) return;
      this._wired = true;
      this.attachShadow({ mode: 'open' }).appendChild(TPL.content.cloneNode(true));
      const root = this.shadowRoot;
      this.$ = (s) => root.querySelector(s);
      this.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.mode = 'idle'; this.peekRAF = 0; this.runRAF = 0;

      this._build();
      this._boot();

      this._onResize = () => this.layout();
      this._ro = new ResizeObserver(this._onResize);
      this._ro.observe(this);

      // SIGN IN button → emit `submit`. In autoplay/demo mode, also play().
      this.$('#login').addEventListener('click', (e) => {
        if (e.target.closest('#signinBtn')) {
          this.dispatchEvent(new CustomEvent('submit', { bubbles: true, composed: true,
            detail: { email: this.getAttribute('email') || 'you@warren.ink' } }));
          if (this.hasAttribute('autoplay')) this.play();
        }
      });
    }

    disconnectedCallback() {
      cancelAnimationFrame(this.peekRAF); cancelAnimationFrame(this.runRAF);
      if (this._ro) this._ro.disconnect();
    }

    attributeChangedCallback(name) {
      if (name === 'email' && this.shadowRoot) {
        const t = this.$('#emailTx'); if (t) t.textContent = this.getAttribute('email') || 'you@warren.ink';
      }
    }

    // ── scene markup (verbatim paths from the prototype) ───────────────────
    _build() {
      const email = this.getAttribute('email') || 'you@warren.ink';
      // rabbit: ears only (black-filled so the hole never shows through)
      this.$('#rabbit').innerHTML =
        `<g transform="translate(-67,-58)">
          <g class="ear earB">
            <path class="ln" style="fill:var(--bg)" pathLength="1" d="M74,66 C69,42 63,8 66,-12 C68,-20 75,-20 78,-10 C80,14 80,44 82,66"/>
            <path class="ln thin" pathLength="1" d="M72,42 C70,24 70,4 73,-6"/>
          </g>
          <g class="ear earF">
            <path class="ln" style="fill:var(--bg)" pathLength="1" d="M86,64 C88,40 92,6 99,-12 C104,-18 109,-12 107,0 C103,26 98,46 96,64"/>
            <path class="ln thin" pathLength="1" d="M93,40 C94,22 97,6 101,-4"/>
          </g>
        </g>`;
      // floating hole above the card
      this.$('#holes').innerHTML =
        `<ellipse class="ln acc" pathLength="1" cx="0" cy="-244" rx="118" ry="13"/>`;
      // the card
      this.$('#cardBody').innerHTML = `
        <rect class="ln" pathLength="1" x="-170" y="-190" width="340" height="380"/>
        <g transform="translate(-90,-162)">
          <ellipse class="ln acc" pathLength="1" cx="12" cy="17" rx="11" ry="3.2"/>
          <path class="ln acc" pathLength="1" d="M9,16 C7.5,10 8,4 11,3 C13.5,4.5 12.5,11 12,16"/>
          <path class="ln acc" pathLength="1" d="M13,16 C13.5,10 15.5,5 18,5.5 C19.5,8 16,13 15,16"/>
        </g>
        <text class="tx acc" x="16" y="-150" style="font-size:20px;letter-spacing:.1em">RABBIT HOLE</text>
        <rect class="ln thin" pathLength="1" x="-135" y="-122" width="270" height="36"/>
        <line class="ln thin" pathLength="1" x1="0" y1="-122" x2="0" y2="-86"/>
        <text class="tx acc" x="-67" y="-103" style="font-size:13px;letter-spacing:.16em">SIGN IN</text>
        <text class="tx dim" x="67" y="-103" style="font-size:13px;letter-spacing:.16em">SIGN UP</text>
        <text class="tx dim l" x="-133" y="-60" style="font-size:10px;letter-spacing:.22em">EMAIL</text>
        <rect class="ln thin" pathLength="1" x="-135" y="-50" width="270" height="36"/>
        <text id="emailTx" class="tx l" x="-122" y="-32" style="font-size:13px;letter-spacing:.04em">${email}</text>
        <text class="tx dim l" x="-133" y="-4" style="font-size:10px;letter-spacing:.22em">PASSWORD</text>
        <rect class="ln thin" pathLength="1" x="-135" y="6" width="270" height="36"/>
        <text class="tx l" x="-122" y="25" style="font-size:13px;letter-spacing:.18em">**********</text>
        <g id="signinBtn">
          <rect class="ln acc" pathLength="1" x="-135" y="64" width="270" height="44"/>
          <text class="tx acc" x="0" y="87" style="font-size:14px;letter-spacing:.2em">SIGN IN</text>
        </g>
        <text class="tx dim" x="0" y="150" style="font-size:10px;letter-spacing:.16em">press sign in &#183; follow the rabbit</text>`;
    }

    // ── draw-on / draw-off ─────────────────────────────────────────────────
    _drawIn(group, { stagger = 14, dur = 620, delay = 0 } = {}) {
      group.querySelectorAll('.ln').forEach((p, i) => {
        p.style.transition = `stroke-dashoffset ${dur}ms ease ${delay + i * stagger}ms`;
        requestAnimationFrame(() => p.style.strokeDashoffset = '0');
      });
      group.querySelectorAll('.tx').forEach((t, i) => {
        t.style.transition = `opacity 320ms ease ${delay + i * stagger + 160}ms`;
        requestAnimationFrame(() => t.style.opacity = t.classList.contains('dim') ? '0.85' : '1');
      });
    }
    _drawOut(group, { stagger = 8, dur = 420, delay = 0 } = {}) {
      group.querySelectorAll('.ln').forEach((p, i) => {
        p.style.transition = `stroke-dashoffset ${dur}ms ease ${delay + i * stagger}ms`;
        requestAnimationFrame(() => p.style.strokeDashoffset = '1');
      });
      group.querySelectorAll('.tx').forEach((t) => {
        t.style.transition = `opacity 220ms ease ${delay}ms`;
        requestAnimationFrame(() => t.style.opacity = '0');
      });
    }
    // unravel like pulling string (strokes retract, last→first)
    _unravel(group) {
      const els = [...group.querySelectorAll('.ln')], N = els.length;
      els.forEach((p, i) => {
        const d = (N - 1 - i) * 15;
        p.style.transition = `stroke-dashoffset 300ms cubic-bezier(.65,0,.85,.25) ${d}ms`;
        requestAnimationFrame(() => p.style.strokeDashoffset = '1');
      });
      group.querySelectorAll('.tx').forEach((t) => {
        t.style.transition = 'opacity 160ms ease'; requestAnimationFrame(() => t.style.opacity = '0');
      });
    }

    // ── responsive layout (identical math to the prototype) ────────────────
    layout() {
      const VW = this.clientWidth || 360, VH = this.clientHeight || 640;
      this.VW = VW; this.VH = VH;
      this.K = Math.max(0.45, Math.min(1.05, (VW - 32) / 360));
      this.CX = VW / 2; this.CY = VH / 2;
      this.CB = this.CY + 190 * this.K; this.S = 1.28 * this.K; this.HCY = this.CY - 244 * this.K;
      const scene = this.$('.scene');
      scene.setAttribute('viewBox', `0 0 ${VW} ${VH}`);
      this.$('#login').setAttribute('transform', `translate(${this.CX},${this.CY}) scale(${this.K})`);
      const ct = this.$('#clipTop'), cb = this.$('#clipBot');
      ct.setAttribute('x', -50); ct.setAttribute('y', -50);
      ct.setAttribute('width', VW + 100); ct.setAttribute('height', Math.max(0, this.HCY - 6 * this.K + 50));
      cb.setAttribute('x', -50); cb.setAttribute('y', this.CB);
      cb.setAttribute('width', VW + 100); cb.setAttribute('height', Math.max(0, VH - this.CB + 120));
      if (this.mode === 'peek' || this.mode === 'idle') this._place(this.CX, this.HCY + 34 * this.K, 0, 1, 1);
    }
    _place(x, y, rot, sx, sy) {
      this.$('#rabbit').setAttribute('transform',
        `translate(${x},${y}) rotate(${(rot || 0).toFixed(2)}) scale(${(this.S * (sx || 1)).toFixed(3)},${(this.S * (sy || 1)).toFixed(3)})`);
    }

    _startPeek() {
      this.mode = 'peek';
      this.$('#rabbit').classList.add('peeking');
      if (this.reduce) { this._place(this.CX, this.HCY + 34 * this.K); return; }
      const t0 = performance.now();
      const loop = (now) => {
        if (this.mode !== 'peek') return;
        const e = (now - t0) / 1000;
        this._place(this.CX, this.HCY + 34 * this.K - Math.abs(Math.sin(e * 1.05)) * 13 * this.K, Math.sin(e * 2.1) * 2.4, 1, 1);
        this.peekRAF = requestAnimationFrame(loop);
      };
      this.peekRAF = requestAnimationFrame(loop);
    }

    // ── THE TRANSITION (exact phases / easings) ────────────────────────────
    play() {
      if (this.mode === 'run' || this.mode === 'done') return;
      cancelAnimationFrame(this.peekRAF); this.mode = 'run';
      this.$('#rabbit').classList.remove('peeking');
      const K = this.K, CX = this.CX, HCY = this.HCY;
      const peekY = HCY + 34 * K, riseY = HCY, downY = HCY + 34 * K + 150 * K;
      const DIP = 120, PERK = DIP + 240, HOLD = PERK + 150, A = HOLD + 290;
      const UNRAVEL_AT = A - 40, BLACK_AT = A + 200, END = A + 800;
      const easeIn = (p) => p * p;
      const easeOutBack = (p) => { const c = 2.4; return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2); };
      const black = this.$('#black');

      const finish = () => {
        this.mode = 'done';
        this.dispatchEvent(new CustomEvent('signin', { bubbles: true, composed: true,
          detail: { email: this.getAttribute('email') || 'you@warren.ink' } }));
      };

      if (this.reduce) {
        this._place(CX, downY); this._drawOut(this.$('#cardBody')); this._drawOut(this.$('#holes'));
        black.style.opacity = '1'; finish(); return;
      }

      let unrav = false, dashed = false, ended = false;
      const t0 = performance.now();
      const loop = (now) => {
        const t = now - t0;
        if (t <= A) {
          let yy, sx = 1, sy = 1;
          if (t <= DIP) { const p = t / DIP; yy = peekY + 10 * K * Math.sin(Math.PI * 0.5 * p); sy = 1 - 0.06 * p; sx = 1 + 0.06 * p; }
          else if (t <= PERK) { const p = (t - DIP) / (PERK - DIP); yy = (peekY + 10 * K) + (riseY - (peekY + 10 * K)) * easeOutBack(p);
            const q = Math.sin(Math.PI * Math.min(1, p * 1.2)); sy = 1 + 0.16 * q; sx = 1 - 0.13 * q; }
          else if (t <= HOLD) { const p = (t - PERK) / (HOLD - PERK); yy = riseY + 2 * K * Math.sin(p * Math.PI * 5); }
          else { const p = (t - HOLD) / (A - HOLD); yy = riseY + (downY - riseY) * easeIn(p); sy = 1 + 0.14 * p; sx = 1 - 0.08 * p; }
          this._place(CX, yy, 0, sx, sy);
        }
        if (t >= UNRAVEL_AT && !unrav) { unrav = true; this._unravel(this.$('#cardBody')); this._unravel(this.$('#holes')); }
        if (t >= BLACK_AT && !dashed) { dashed = true; black.style.opacity = '1'; }
        if (t >= END && !ended) { ended = true; finish(); return; }
        this.runRAF = requestAnimationFrame(loop);
      };
      this.runRAF = requestAnimationFrame(loop);
    }

    // abort a play() that was started optimistically (e.g. auth failed)
    fail() { this.reset(); }

    reset() {
      cancelAnimationFrame(this.runRAF); cancelAnimationFrame(this.peekRAF);
      this.mode = 'idle';
      this.$('#rabbit').classList.remove('peeking');
      const black = this.$('#black'); black.style.transition = 'none'; black.style.opacity = '0';
      ['#holes', '#cardBody'].forEach((sel) => {
        this.$(sel).querySelectorAll('.ln').forEach((p) => { p.style.transition = 'none'; p.style.strokeDashoffset = '1'; });
        this.$(sel).querySelectorAll('.tx').forEach((t) => { t.style.transition = 'none'; t.style.opacity = '0'; });
      });
      this.$('#rabbit').querySelectorAll('.ln').forEach((p) => { p.style.transition = 'none'; p.style.strokeDashoffset = '1'; });
      this.layout(); this._place(this.CX, this.HCY + 34 * this.K);
      requestAnimationFrame(() => {
        this._drawIn(this.$('#holes'), { stagger: 10 });
        this._drawIn(this.$('#cardBody'), { stagger: 11, delay: 160 });
        this._drawIn(this.$('#rabbit'), { stagger: 16, delay: 520 });
        setTimeout(() => this._startPeek(), 720);
      });
    }

    _boot() {
      this.layout(); this._place(this.CX, this.HCY + 34 * this.K);
      this._drawIn(this.$('#holes'), { stagger: 10 });
      this._drawIn(this.$('#cardBody'), { stagger: 11, delay: 240 });
      this._drawIn(this.$('#rabbit'), { stagger: 16, delay: 560 });
      setTimeout(() => this._startPeek(), 900);
    }
  }

  if (!customElements.get('rabbit-hole-signin')) {
    customElements.define('rabbit-hole-signin', RabbitHoleSignin);
  }
})();
