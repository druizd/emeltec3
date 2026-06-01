import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

export interface VertienteData {
  nombre: string;
  sensorId: string;
  nivel: string;
  caudal: string;
  caudalPct: number;
  volumen: string;
  temp: string;
  ultimaHora: string;
  ultimaFecha: string;
}

@Component({
  selector: 'app-vertiente-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './vertiente-panel.component.html',
  styleUrls: ['./vertiente-panel.component.css'],
})
export class VertientePanelComponent implements OnChanges {
  @Input() data: VertienteData = {
    nombre: 'VERTIENTE',
    sensorId: '',
    nivel: '0,00',
    caudal: '0,00',
    caudalPct: 0,
    volumen: '0',
    temp: '—',
    ultimaHora: '—',
    ultimaFecha: '',
  };

  svg!: SafeHtml;

  constructor(private sanitizer: DomSanitizer) {
    this.svg = this.sanitizer.bypassSecurityTrustHtml(this.buildSvg());
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['data']) {
      this.svg = this.sanitizer.bypassSecurityTrustHtml(this.buildSvg());
    }
  }

  private rock(cx: number, cy: number, r: number): string {
    return `<g>
      <ellipse cx="${cx}" cy="${cy + r * 0.16}" rx="${r}" ry="${r * 0.8}" fill="#828a8f"/>
      <ellipse cx="${cx - r * 0.16}" cy="${cy - r * 0.12}" rx="${r * 0.78}" ry="${r * 0.58}" fill="#9aa1a6"/>
      <ellipse cx="${cx - r * 0.3}" cy="${cy - r * 0.28}" rx="${r * 0.38}" ry="${r * 0.24}" fill="#b4bbbf"/>
    </g>`;
  }

  private tuft(x: number, y: number, s = 1): string {
    return `<g stroke="#4e9c3c" stroke-width="${1.6 * s}" stroke-linecap="round">
      <path d="M${x},${y} q-${3 * s},-${7 * s} -${5 * s},-${9 * s}"/>
      <path d="M${x},${y} l0,-${11 * s}"/>
      <path d="M${x},${y} q${3 * s},-${7 * s} ${5 * s},-${9 * s}"/></g>`;
  }

  private tagbox(
    x: number,
    y: number,
    lines: string[],
    color: string,
    tx: number,
    ty: number,
  ): string {
    const w = Math.max(...lines.map((l) => l.length)) * 6.2 + 18;
    const h = lines.length * 15 + 9;
    const t = lines
      .map(
        (l, i) =>
          `<text x="${x + 10}" y="${y + 17 + i * 15}" font-family="DM Sans" font-size="11.5" font-weight="800" letter-spacing=".06em" fill="${color}">${l}</text>`,
      )
      .join('');
    return `<g>
      <line x1="${x + w / 2}" y1="${ty > y ? y + h : y}" x2="${tx}" y2="${ty}" stroke="${color}" stroke-width="1.4" stroke-dasharray="3 3" opacity=".7"/>
      <circle cx="${tx}" cy="${ty}" r="3" fill="${color}"/>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="9" fill="rgba(255,255,255,.72)" stroke="rgba(255,255,255,.9)"/>
      ${t}</g>`;
  }

  private buildSvg(): string {
    let grid = '';
    for (let x = 0; x <= 620; x += 38)
      grid += `<line x1="${x}" y1="0" x2="${x}" y2="560" stroke="#5f8f93" stroke-width="1" opacity=".05"/>`;
    for (let y = 0; y <= 560; y += 38)
      grid += `<line x1="0" y1="${y}" x2="620" y2="${y}" stroke="#5f8f93" stroke-width="1" opacity=".05"/>`;

    let bubbles = '';
    (
      [
        [230, 4],
        [280, 5],
        [320, 3.6],
        [262, 4.4],
        [300, 3.4],
      ] as number[][]
    ).forEach((b, i) => {
      const dur = (3 + i * 0.5).toFixed(1);
      bubbles += `<circle cx="${b[0]}" cy="445" r="${b[1] * 0.45 + 1}" fill="#ffffff" opacity="0">
        <animate attributeName="cy" values="445;360" dur="${dur}s" begin="${(i * 0.7).toFixed(1)}s" repeatCount="indefinite"/>
        <animate attributeName="opacity" values="0;.6;.6;0" dur="${dur}s" begin="${(i * 0.7).toFixed(1)}s" repeatCount="indefinite"/></circle>`;
    });

    const nivel = this.escape(this.data.nivel);

    return `
<svg viewBox="0 0 620 560" preserveAspectRatio="xMidYMid slice" style="width:100%;height:100%;display:block" role="img" aria-label="Diorama ${this.escape(this.data.nombre)}">
  <style>
    @keyframes flow{to{stroke-dashoffset:-40}}
    @keyframes drop{0%{transform:translateY(0);opacity:0}10%{opacity:1}90%{opacity:1}100%{transform:translateY(46px);opacity:0}}
    @keyframes surface{0%,100%{transform:translateX(0)}50%{transform:translateX(-14px)}}
    .flow-stream{stroke-dasharray:5 7;animation:flow 1s linear infinite}
    .drop{animation:drop 1.4s ease-in infinite}
    .surface{animation:surface 4.5s ease-in-out infinite}
  </style>
  <defs>
    <linearGradient id="soil" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#cbc5b8"/><stop offset="1" stop-color="#a59b89"/></linearGradient>
    <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#79bd5a"/><stop offset="1" stop-color="#5aa244"/></linearGradient>
    <radialGradient id="waterSurf" cx="42%" cy="36%" r="70%"><stop offset="0" stop-color="#bff1f7" stop-opacity=".7"/><stop offset="1" stop-color="#3fb6cf" stop-opacity=".55"/></radialGradient>
    <linearGradient id="waterBody" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9fe7f0" stop-opacity=".62"/><stop offset="1" stop-color="#2a9cba" stop-opacity=".82"/></linearGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6e9ec"/><stop offset="1" stop-color="#c0c6cc"/></linearGradient>
    <linearGradient id="metalV" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#9aa3ad"/><stop offset=".45" stop-color="#eef1f4"/><stop offset=".6" stop-color="#c6cdd4"/><stop offset="1" stop-color="#8f99a3"/></linearGradient>
    <linearGradient id="pipe" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#aeb6bf"/><stop offset=".5" stop-color="#e9edf1"/><stop offset="1" stop-color="#8b95a0"/></linearGradient>
    <clipPath id="bodyClip"><path d="M112,352 Q262,404 412,352 C402,424 326,458 262,458 C198,458 122,424 112,352 Z"/></clipPath>
  </defs>

  <g>${grid}</g>

  <!-- HILLSIDE + WATERFALL -->
  <path d="M0,540 L0,300 C30,250 78,238 132,300 L150,372 L40,430 L0,470 Z" fill="url(#grass)"/>
  <path d="M16,330 Q60,295 110,330 L120,388 L20,402 Z" fill="#4f9b3d" opacity=".5"/>
  ${this.tuft(34, 300, 1.1)}${this.tuft(78, 288)}${this.tuft(110, 316)}${this.tuft(28, 360, 1.1)}${this.tuft(70, 348)}${this.tuft(128, 338)}
  ${this.rock(96, 330, 20)}${this.rock(150, 322, 18)}${this.rock(70, 360, 16)}${this.rock(132, 360, 17)}${this.rock(176, 348, 15)}${this.rock(112, 300, 13)}
  <ellipse cx="128" cy="318" rx="13" ry="7" fill="#2f4a4f"/>
  <ellipse cx="128" cy="317" rx="9" ry="4.5" fill="#bdeef4"/>
  <path d="M126,320 C128,348 150,362 178,362 L198,360" fill="none" stroke="#cfeef4" stroke-width="18" stroke-linecap="round" opacity=".7"/>
  <path class="flow-stream" d="M126,320 C128,348 150,362 178,362 L198,360" fill="none" stroke="#ffffff" stroke-width="5" stroke-linecap="round"/>
  <path class="flow-stream" d="M134,322 C138,346 156,358 180,357" fill="none" stroke="#eafbff" stroke-width="2.5" stroke-linecap="round" style="animation-delay:.4s"/>
  <circle class="drop" cx="150" cy="356" r="2.6" fill="#fff"/><circle class="drop" cx="170" cy="360" r="2.2" fill="#fff" style="animation-delay:.6s"/>

  <!-- GROUND CUTAWAY -->
  <path d="M96,525 L96,360 C100,348 110,344 122,346 Q262,300 404,346 C418,348 426,356 426,368 L426,525 Z" fill="url(#soil)"/>
  <path d="M404,346 C418,348 426,356 426,368 L426,525 L398,525 L398,360 Z" fill="#9a907e" opacity=".5"/>
  <g fill="#9aa0a2"><circle cx="120" cy="470" r="6"/><circle cx="150" cy="500" r="7"/><circle cx="402" cy="470" r="6"/><circle cx="380" cy="505" r="7"/><circle cx="262" cy="505" r="6"/></g>

  <!-- POOL -->
  <path d="M112,352 A152,46 0 0 1 412,352" fill="none" stroke="url(#rim)" stroke-width="10" stroke-linecap="round"/>
  <path d="M112,352 Q262,404 412,352 C402,424 326,458 262,458 C198,458 122,424 112,352 Z" fill="url(#waterBody)"/>
  <g clip-path="url(#bodyClip)">
    <g fill="#7f8a86" opacity=".7"><circle cx="210" cy="440" r="9"/><circle cx="245" cy="450" r="11"/><circle cx="285" cy="446" r="10"/><circle cx="320" cy="438" r="9"/><circle cx="262" cy="432" r="8"/><circle cx="180" cy="430" r="7"/><circle cx="345" cy="428" r="7"/></g>
    <g fill="#6aa6a0" opacity=".45"><circle cx="220" cy="438" r="9"/><circle cx="300" cy="445" r="10"/></g>
    ${bubbles}
    <path d="M112,352 Q262,404 412,352" fill="none" stroke="#ffffff" stroke-width="2" opacity=".45"/>
    <path d="M150,360 C170,400 200,420 230,428" fill="none" stroke="#dffafe" stroke-width="2" opacity=".3"/>
  </g>
  <path d="M112,352 C122,424 198,458 262,458 C326,458 402,424 412,352" fill="none" stroke="#cfd6da" stroke-width="3" opacity=".8"/>

  <ellipse cx="262" cy="352" rx="152" ry="46" fill="url(#waterSurf)"/>
  <ellipse cx="262" cy="352" rx="152" ry="46" fill="none" stroke="#eafcff" stroke-width="1.6" opacity=".8"/>
  <g class="surface">
    <ellipse cx="240" cy="346" rx="92" ry="16" fill="none" stroke="#ffffff" stroke-width="1.4" opacity=".5"/>
    <ellipse cx="262" cy="356" rx="60" ry="9" fill="none" stroke="#ffffff" stroke-width="1.2" opacity=".35"/>
  </g>
  <ellipse cx="196" cy="356" rx="10" ry="3" fill="none" stroke="#ffffff" stroke-width="1.8">
    <animate attributeName="rx" values="8;52" dur="2.2s" repeatCount="indefinite"/>
    <animate attributeName="ry" values="2.4;14" dur="2.2s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values=".85;0" dur="2.2s" repeatCount="indefinite"/>
  </ellipse>

  <!-- OUTLET PIPE -->
  <rect x="392" y="398" width="62" height="20" rx="10" fill="url(#pipe)" transform="rotate(8 423 408)"/>
  <ellipse cx="452" cy="414" rx="6" ry="10" fill="#788490"/>
  <path class="flow-stream" d="M452,420 C456,438 452,452 444,466" fill="none" stroke="#7fd6e6" stroke-width="5" stroke-linecap="round"/>
  <path d="M452,420 C456,438 452,452 444,466" fill="none" stroke="#bfeef6" stroke-width="9" stroke-linecap="round" opacity=".4"/>

  <!-- SENSOR POLE + AMBER SENSOR -->
  <rect x="316" y="196" width="11" height="118" rx="4" fill="url(#metalV)"/>
  <rect x="296" y="194" width="44" height="10" rx="5" fill="url(#metalV)"/>
  <ellipse cx="300" cy="190" rx="13" ry="5" fill="#aeb6bf"/><ellipse cx="300" cy="188" rx="9" ry="3" fill="#cdd4db"/>
  <rect x="305" y="206" width="40" height="34" rx="9" fill="#f0b63e" stroke="#ffd470" stroke-width="2"/>
  <rect x="313" y="213" width="18" height="6" rx="3" fill="#fff2cf"/>
  <rect x="318" y="240" width="14" height="9" rx="4" fill="#d79a2c"/>
  <g stroke="#eaa72f" stroke-width="1.4" stroke-dasharray="4 5" opacity=".8" fill="none">
    <line x1="320" y1="250" x2="250" y2="352"/><line x1="328" y1="250" x2="392" y2="352"/>
  </g>
  <ellipse cx="321" cy="352" rx="8" ry="2.6" fill="none" stroke="#eaa72f" stroke-width="1.6">
    <animate attributeName="rx" values="6;40" dur="1.8s" repeatCount="indefinite"/>
    <animate attributeName="ry" values="2;11" dur="1.8s" repeatCount="indefinite"/>
    <animate attributeName="opacity" values=".85;0" dur="1.8s" repeatCount="indefinite"/>
  </ellipse>

  <!-- WIFI UPLINK -->
  <path id="upPath" d="M346,222 L420,222" fill="none" stroke="#2bb6ab" stroke-width="1.4" stroke-dasharray="2 6" opacity=".55"/>
  <circle r="2.6" fill="#2bb6ab"><animateMotion dur="1.8s" repeatCount="indefinite"><mpath href="#upPath"/></animateMotion></circle>
  <circle r="2.6" fill="#2bb6ab"><animateMotion dur="1.8s" begin=".9s" repeatCount="indefinite"><mpath href="#upPath"/></animateMotion></circle>
  <g stroke="#2bb6ab" stroke-width="2.2" fill="none" stroke-linecap="round">
    <circle cx="420" cy="222" r="2.6" fill="#2bb6ab" stroke="none"/>
    <path d="M413,216 a10,10 0 0 1 14,0"><animate attributeName="opacity" values=".4;1;.4" dur="1.8s" repeatCount="indefinite"/></path>
    <path d="M409,210 a16,16 0 0 1 22,0"><animate attributeName="opacity" values=".3;.9;.3" dur="1.8s" begin=".2s" repeatCount="indefinite"/></path>
  </g>

  <!-- WATER-LEVEL DIMENSION -->
  <line x1="300" y1="352" x2="426" y2="352" stroke="#2bb6ab" stroke-width="1.4" stroke-dasharray="5 4"/>
  <circle cx="300" cy="352" r="3.4" fill="#2bb6ab"/><circle cx="426" cy="352" r="3.4" fill="#2bb6ab"/>
  <line x1="388" y1="352" x2="388" y2="372" stroke="#2bb6ab" stroke-width="1.4" stroke-dasharray="4 4" opacity=".7"/>
  <text x="342" y="336" text-anchor="middle" font-family="DM Sans" font-size="13" font-weight="800" fill="#149a8c">NIVEL DE AGUA</text>
  <text x="342" y="357" text-anchor="middle" font-family="JetBrains Mono" font-size="17" font-weight="700" fill="#0e8a7d">${nivel}<tspan font-size="11" dx="2">m</tspan></text>

  <!-- LABELS -->
  ${this.tagbox(26, 250, ['AFORAMIENTO', 'NATURAL'], '#149a8c', 128, 318)}
  <text x="252" y="170" font-family="DM Sans" font-size="13" font-weight="800" letter-spacing=".06em" fill="#e09b1e">SENSOR DE NIVEL</text>
  <text x="200" y="498" text-anchor="middle" font-family="DM Sans" font-size="13" font-weight="800" letter-spacing=".06em" fill="#149a8c">POZA DE ACUMULACIÓN</text>
  ${this.tagbox(404, 470, ['SALIDA DE LA', 'VERTIENTE'], '#149a8c', 448, 448)}
</svg>`;
  }

  private escape(s: string): string {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
