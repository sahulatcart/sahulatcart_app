/* Sahulatkaar site interactions — no dependencies. */
(function () {
  'use strict';

  /* Mobile nav */
  const burger = document.querySelector('.burger');
  const links = document.querySelector('.nav-links');
  if (burger && links) burger.addEventListener('click', () => links.classList.toggle('open'));

  /* Reveal on scroll */
  const io = new IntersectionObserver(
    (es) => es.forEach((e) => e.isIntersecting && e.target.classList.add('on')),
    { threshold: 0.12 }
  );
  document.querySelectorAll('.rv').forEach((el) => io.observe(el));

  /* Count-up stats */
  const cio = new IntersectionObserver((es) => {
    es.forEach((e) => {
      if (!e.isIntersecting || e.target.dataset.done) return;
      e.target.dataset.done = '1';
      const target = parseFloat(e.target.dataset.count);
      const suffix = e.target.dataset.suffix || '';
      const t0 = performance.now();
      const tick = (t) => {
        const p = Math.min((t - t0) / 1400, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        e.target.firstChild.textContent = Math.round(target * eased).toLocaleString('en-PK') + suffix;
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, { threshold: 0.4 });
  document.querySelectorAll('[data-count]').forEach((el) => cio.observe(el));

  /* Hero flip words */
  const flip = document.querySelector('.flip');
  if (flip) {
    const words = JSON.parse(flip.dataset.words);
    let i = 0;
    setInterval(() => {
      i = (i + 1) % words.length;
      flip.innerHTML = '<span class="word">' + words[i] + '</span>';
    }, 2200);
  }

  /* ── Animated WhatsApp negotiation (hero phone) ── */
  const chat = document.getElementById('chat-play');
  if (chat) {
    const T = (h, m) => `<span class="time">${h}:${String(m).padStart(2, '0')} pm</span>`;
    const SCRIPT = [
      { who: 'in', voice: true, wait: 900 },
      { who: 'out', text: 'Walaikum salam! Ji, T-Shirt Rs 2,500 ki hai. Kitni chahiye?' + T(5, 41), wait: 1500, type: true },
      { who: 'in', text: 'Bhai 2000 lagao, 2 leni hain' + T(5, 42), wait: 1400 },
      { who: 'out', text: 'Bhai jaan 2000 mushkil hai 🙈 Rs 2,250 per piece kar deta hoon — 2 ki total Rs 4,500.' + T(5, 42), wait: 1900, type: true },
      { who: 'in', text: 'Acha theek hai, 2250 final' + T(5, 43), wait: 1400 },
      { who: 'out', text: 'Bohat khoob! 🎉 Naam, address aur area bhej dein.' + T(5, 43), wait: 1700, type: true },
      { who: 'in', text: 'Ahmed Raza, House 12, Street 5, Johar Town, Lahore' + T(5, 44), wait: 1500 },
      { who: 'out', text: 'Total Rs 4,700 (delivery Rs 200). COD ya bank transfer?' + T(5, 44), wait: 1700, type: true },
      { who: 'in', text: 'COD' + T(5, 45), wait: 1100 },
      { who: 'out', slip: true, wait: 2200, type: true },
      { who: 'out', text: 'Order SK-1042 confirm ✅ Jald deliver karenge, shukriya!' + T(5, 45), wait: 3600, type: true },
    ];
    const typing = document.createElement('div');
    typing.className = 'typing';
    typing.innerHTML = '<i></i><i></i><i></i>';

    let idx = 0;
    function step() {
      if (idx >= SCRIPT.length) {
        setTimeout(() => { chat.innerHTML = ''; idx = 0; step(); }, 2600);
        return;
      }
      const m = SCRIPT[idx++];
      const show = () => {
        typing.classList.remove('show');
        const b = document.createElement('div');
        b.className = 'bubble ' + m.who + (m.voice ? ' voice' : '') + (m.slip ? ' slip' : '');
        if (m.voice) {
          b.innerHTML = '<span class="mic">🎤</span><span class="wave">' + '<i></i>'.repeat(16) + '</span><span style="font-size:11px;color:#8696a0">0:04</span>';
        } else if (m.slip) {
          b.innerHTML =
            '<div class="slip-head">🧾 Ali Garments — Order SK-1042</div>' +
            '<div class="row"><span>T-Shirt × 2</span><span>Rs 4,500</span></div>' +
            '<div class="row"><span>Delivery</span><span>Rs 200</span></div>' +
            '<div class="row total"><span>Total (COD)</span><span>Rs 4,700</span></div>';
        } else {
          b.innerHTML = m.text;
        }
        chat.appendChild(b);
        chat.scrollTop = chat.scrollHeight;
        setTimeout(step, m.wait);
      };
      if (m.type) {
        chat.appendChild(typing);
        typing.classList.add('show');
        chat.scrollTop = chat.scrollHeight;
        setTimeout(show, 750);
      } else {
        show();
      }
    }
    // start when visible
    const pio = new IntersectionObserver((es) => {
      if (es[0].isIntersecting) { pio.disconnect(); step(); }
    }, { threshold: 0.3 });
    pio.observe(chat);
  }

  /* ── Personality dial demo ── */
  const dial = document.getElementById('dial-demo');
  if (dial) {
    const REPLIES = {
      narm: { text: 'Bhai jaan aap ke liye Rs 2,200 kar deta hoon 😊 Aur kuch chahiye ho to batayein!', note: 'Narm — concedes quickly, extra warm' },
      standard: { text: 'Rs 2,250 tak kar sakta hoon, ye acha rate hai. Kya kehte hain?', note: 'Standard — balanced haggling' },
      sakht: { text: 'Maal ki quality dekhein bhai — Rs 2,400 se kam mushkil hai. Ye final samjhein.', note: 'Sakht — protects your margin' },
    };
    const out = dial.querySelector('.dial-reply');
    dial.querySelectorAll('.dial-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        dial.querySelectorAll('.dial-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const r = REPLIES[btn.dataset.style];
        out.style.animation = 'none'; void out.offsetWidth; out.style.animation = '';
        out.innerHTML = r.text + '<small>' + r.note + ' · customer offered Rs 2,000 on a Rs 2,500 shirt</small>';
      });
    });
  }

  /* ── Pricing toggle ── */
  const toggle = document.getElementById('bill-toggle');
  if (toggle) {
    const prices = document.querySelectorAll('[data-monthly]');
    toggle.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        toggle.querySelectorAll('button').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const yearly = btn.dataset.mode === 'yearly';
        prices.forEach((p) => {
          p.textContent = 'Rs ' + Number(yearly ? p.dataset.yearly : p.dataset.monthly).toLocaleString('en-PK');
        });
      });
    });
  }

  /* ─────────────────────────────────────────────────────────────
     TEMPORARY — Railway deploy canary. Remove once the pipeline is
     confirmed. Stamped with the commit it was built from, so seeing it
     tells us WHICH build is live, not merely that something deployed.
     ───────────────────────────────────────────────────────────── */
  var DEPLOY_STAMP = 'c476cca · 2026-09-18';
  var box = document.createElement('div');
  box.setAttribute('role', 'status');
  box.style.cssText = [
    'position:fixed', 'right:18px', 'bottom:18px', 'z-index:9999',
    'background:#0b1f18', 'color:#fff', 'border:1px solid rgba(255,255,255,.18)',
    'border-radius:12px', 'padding:14px 16px', 'max-width:270px',
    'font:14px/1.45 Inter,system-ui,sans-serif',
    'box-shadow:0 18px 40px -14px rgba(0,0,0,.55)'
  ].join(';');
  box.innerHTML =
    '<div style="font-weight:700;margin-bottom:3px">Hello 👋</div>' +
    '<div style="font-size:12px;opacity:.75">Deploy test · build ' + DEPLOY_STAMP + '</div>' +
    '<button type="button" aria-label="Dismiss" style="position:absolute;top:6px;right:9px;' +
    'background:none;border:0;color:#fff;opacity:.55;font-size:17px;line-height:1;cursor:pointer">&times;</button>';
  box.querySelector('button').addEventListener('click', function () { box.remove(); });
  document.body.appendChild(box);
})();
