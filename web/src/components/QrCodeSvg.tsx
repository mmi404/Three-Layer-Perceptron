import React, { useMemo } from 'react';

interface QrCodeSvgProps {
  value: string;
  size?: number;
  fgColor?: string;
  bgColor?: string;
}

export const QrCodeSvg: React.FC<QrCodeSvgProps> = ({
  value,
  size = 135,
  fgColor = '#060913',
  bgColor = '#ffffff'
}) => {
  const matrix = useMemo(() => {
    const gridDim = 25;
    const grid: boolean[][] = Array.from({ length: gridDim }, () => Array(gridDim).fill(false));

    // 1. Draw 7x7 Finder Patterns at 3 corners
    const drawFinder = (top: number, left: number) => {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
          const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
          grid[top + r][left + c] = isBorder || isCenter;
        }
      }
    };

    drawFinder(0, 0);
    drawFinder(0, gridDim - 7);
    drawFinder(gridDim - 7, 0);

    // 2. Timing Patterns (Row 6 & Col 6)
    for (let i = 8; i < gridDim - 8; i++) {
      grid[6][i] = i % 2 === 0;
      grid[i][6] = i % 2 === 0;
    }

    // 3. Standard Alignment Pattern at (18, 18)
    const alignR = 18;
    const alignC = 18;
    for (let r = -2; r <= 2; r++) {
      for (let c = -2; c <= 2; c++) {
        const isBorder = Math.abs(r) === 2 || Math.abs(c) === 2;
        const isCenter = r === 0 && c === 0;
        grid[alignR + r][alignC + c] = isBorder || isCenter;
      }
    }

    // 4. Dark Module
    grid[gridDim - 8][8] = true;

    // 5. Populate Data Modules with deterministic hash bits
    let hash = 0;
    for (let i = 0; i < value.length; i++) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }

    let seed = Math.abs(hash) + 12345;
    for (let r = 0; r < gridDim; r++) {
      for (let c = 0; c < gridDim; c++) {
        // Skip Finder patterns and separators
        if (
          (r < 8 && c < 8) ||
          (r < 8 && c >= gridDim - 8) ||
          (r >= gridDim - 8 && c < 8) ||
          r === 6 ||
          c === 6 ||
          (r >= alignR - 2 && r <= alignR + 2 && c >= alignC - 2 && c <= alignC + 2)
        ) {
          continue;
        }
        seed = (seed * 9301 + 49297) % 233280;
        grid[r][c] = seed / 233280 > 0.48;
      }
    }

    return grid;
  }, [value]);

  const gridDim = 25;
  const cellSize = 5;
  const totalDim = gridDim * cellSize;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${totalDim} ${totalDim}`} className="rounded-xl shadow-inner">
      <rect width={totalDim} height={totalDim} fill={bgColor} />
      {matrix.map((row, r) =>
        row.map((active, c) =>
          active ? (
            <rect
              key={`${r}-${c}`}
              x={c * cellSize}
              y={r * cellSize}
              width={cellSize}
              height={cellSize}
              fill={fgColor}
            />
          ) : null
        )
      )}
    </svg>
  );
};
