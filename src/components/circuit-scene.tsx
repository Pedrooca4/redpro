type Point = readonly [number, number];

const project = (x: number, y: number, elevation = 0): Point => [
  320 + (x - y) * 43,
  114 + (x + y) * 23 - elevation,
];

const points = (...vertices: Point[]) => vertices.map(([x, y]) => `${x},${y}`).join(" ");

function Block({
  x,
  y,
  height = 18,
  elevation = 0,
  top = "#293A2B",
  left = "#17271B",
  right = "#203023",
  size = 0.94,
}: {
  x: number;
  y: number;
  height?: number;
  elevation?: number;
  top?: string;
  left?: string;
  right?: string;
  size?: number;
}) {
  const a = project(x, y, elevation);
  const b = project(x + size, y, elevation);
  const c = project(x + size, y + size, elevation);
  const d = project(x, y + size, elevation);
  const lower = ([px, py]: Point): Point => [px, py + height];

  return (
    <g stroke="#49604A" strokeOpacity=".35" strokeLinejoin="round">
      <polygon points={points(d, c, lower(c), lower(d))} fill={left} />
      <polygon points={points(b, c, lower(c), lower(b))} fill={right} />
      <polygon points={points(a, b, c, d)} fill={top} />
    </g>
  );
}

function Trace({ route, color = "#E45D48" }: { route: readonly Point[]; color?: string }) {
  const line = route.map(([x, y]) => project(x, y, 2));

  return (
    <g fill="none" stroke={color} strokeLinejoin="miter">
      <polyline points={points(...line)} strokeWidth="11" opacity=".08" />
      <polyline points={points(...line)} strokeWidth="4" opacity=".8" />
      {line.map(([x, y], index) => (
        <rect
          key={index}
          x={x - 2.5}
          y={y - 2.5}
          width="5"
          height="5"
          fill={color}
          stroke="none"
          transform={`rotate(45 ${x} ${y})`}
        />
      ))}
    </g>
  );
}

function Torch({ x, y }: { x: number; y: number }) {
  const [px, py] = project(x, y, 4);

  return (
    <g transform={`translate(${px} ${py})`}>
      <ellipse cy="2" rx="14" ry="7" fill="#E45D48" opacity=".12" />
      <path d="M-3 0V-28L3-31V-3Z" fill="#5E4C35" />
      <path d="M3-3V-31L7-28V0Z" fill="#302C21" />
      <path d="M-7-31V-43L1-47L10-42V-30L2-25Z" fill="#E45D48" />
      <path d="M-7-43L1-47L10-42L2-38Z" fill="#FFA683" />
      <path d="M2-38V-25L10-30V-42Z" fill="#A43D30" />
      <circle cy="-36" r="22" fill="url(#minepro-torch-glow)" />
    </g>
  );
}

/** Decorative artwork only: this is not a build plan or a validated circuit. */
export function CircuitScene() {
  return (
    <svg
      viewBox="0 0 640 480"
      fill="none"
      aria-hidden="true"
      focusable="false"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id="minepro-board-glow">
          <stop stopColor="#55F56B" stopOpacity=".12" />
          <stop offset="1" stopColor="#55F56B" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="minepro-torch-glow">
          <stop stopColor="#E45D48" stopOpacity=".28" />
          <stop offset="1" stopColor="#E45D48" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="minepro-core-top" x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#84FF87" />
          <stop offset="1" stopColor="#42C95A" />
        </linearGradient>
      </defs>

      <ellipse cx="320" cy="264" rx="280" ry="192" fill="url(#minepro-board-glow)" />
      <ellipse cx="320" cy="365" rx="190" ry="45" fill="#060B07" opacity=".55" />

      <g stroke="#55F56B" strokeOpacity=".1" strokeWidth="1">
        <path d="M63 234 320 97 577 234 320 372Z" />
        <path d="M42 246 320 395 598 246" strokeDasharray="3 7" />
        <path d="M320 67V85M320 409V427M26 244H45M596 244H614" />
      </g>

      {Array.from({ length: 25 }, (_, index) => {
        const x = index % 5;
        const y = Math.floor(index / 5);
        return <Block key={index} x={x} y={y} top={(x + y) % 3 === 0 ? "#26382A" : "#202E23"} />;
      })}

      <Trace
        route={[
          [0.5, 1.5],
          [1.5, 1.5],
          [1.5, 3.5],
          [3.5, 3.5],
        ]}
      />
      <Trace
        route={[
          [2.5, 0.5],
          [3.5, 0.5],
          [3.5, 1.5],
          [4.5, 1.5],
        ]}
      />
      <Trace
        route={[
          [2.5, 2.5],
          [3.5, 2.5],
          [3.5, 3.5],
        ]}
        color="#55F56B"
      />
      <Trace
        route={[
          [0.5, 3.5],
          [0.5, 4.5],
          [2.5, 4.5],
          [2.5, 3.5],
        ]}
      />

      <Block
        x={0.1}
        y={1.08}
        height={46}
        elevation={46}
        size={0.78}
        top="#3D5B3E"
        left="#263D2A"
        right="#304D33"
      />
      <Block
        x={0.19}
        y={1.17}
        height={7}
        elevation={53}
        size={0.6}
        top="#77D882"
        left="#3A7043"
        right="#4B8F54"
      />
      <path d="M275 104 288 111 288 122 275 115Z" fill="#55F56B" opacity=".28" />

      <Torch x={2.5} y={0.5} />

      <Block
        x={3.9}
        y={1.08}
        height={44}
        elevation={44}
        size={0.78}
        top="#53614A"
        left="#293C2D"
        right="#394C36"
      />
      <Block
        x={3.98}
        y={1.16}
        height={10}
        elevation={54}
        size={0.62}
        top="#839474"
        left="#3F5140"
        right="#52644A"
      />
      <path d="m460 181 18 10v8l-18-10Z" fill="#BDCA9E" opacity=".35" />

      <Block
        x={2.06}
        y={2.06}
        height={42}
        elevation={42}
        size={0.82}
        top="url(#minepro-core-top)"
        left="#24743A"
        right="#319745"
      />
      <polygon
        points={points(
          project(2.25, 2.25, 43),
          project(2.69, 2.25, 43),
          project(2.69, 2.69, 43),
          project(2.25, 2.69, 43),
        )}
        fill="#C1FFB8"
        opacity=".55"
      />
      <path
        d="M289 209v13l12 7v-13M307 219v13l8 5v-13"
        stroke="#70EB7D"
        strokeOpacity=".4"
        strokeWidth="2"
      />
      <path
        d="M329 225v10l12-6v-10M347 215v10l7-4v-10"
        stroke="#91FF9D"
        strokeOpacity=".4"
        strokeWidth="2"
      />

      <Torch x={0.5} y={3.5} />

      <Block
        x={3.12}
        y={3.12}
        height={27}
        elevation={27}
        size={0.7}
        top="#4B6947"
        left="#27452C"
        right="#355A37"
      />
      <Block
        x={3.22}
        y={3.22}
        height={5}
        elevation={32}
        size={0.5}
        top="#8AE88B"
        left="#467F4C"
        right="#539459"
      />

      <g stroke="#55F56B" strokeWidth="2" opacity=".5">
        <path d="m169 299 31 17m7 4 10 5M438 329l30-16m7-4 10-5" />
      </g>
      <g fill="#55F56B">
        <path d="m213 80 4 2v5l-4 2-4-2v-5Z" opacity=".4" />
        <path d="m462 106 3 2v4l-3 2-3-2v-4Z" opacity=".25" />
        <rect x="116" y="190" width="3" height="3" opacity=".35" />
        <rect x="503" y="366" width="3" height="3" opacity=".35" />
      </g>
      <g stroke="#9CAE9B" strokeWidth="1" opacity=".35">
        <path d="M130 125h11m-5.5-5.5v11M516 283h11m-5.5-5.5v11" />
      </g>
    </svg>
  );
}
