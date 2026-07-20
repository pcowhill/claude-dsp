/** KaTeX-rendered "Math Behind It" block. */

import { useMemo } from 'react';
import katex from 'katex';
import type { MathDoc, ParamValue } from '@/model/types';

function Katex({ tex, display = true }: { tex: string; display?: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { displayMode: display, throwOnError: false });
    } catch {
      return tex;
    }
  }, [tex, display]);
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

export function MathBlock({
  doc,
  params,
  sampleRate,
}: {
  doc: MathDoc;
  params: Record<string, ParamValue>;
  sampleRate: number;
}) {
  const substituted = doc.substitute ? doc.substitute(params, sampleRate) : null;
  return (
    <div className="math-block">
      {doc.equations.map((eq, i) => (
        <Katex key={i} tex={eq} />
      ))}
      {substituted && (
        <>
          <h4>With your current settings</h4>
          <Katex tex={substituted} />
        </>
      )}
      <h4>Symbols</h4>
      <table className="math-symbols">
        <tbody>
          {Object.entries(doc.symbols).map(([sym, meaning]) => (
            <tr key={sym}>
              <td style={{ whiteSpace: 'nowrap' }}>
                <Katex tex={sym} display={false} />
              </td>
              <td>{meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>What it means</h4>
      <div>{doc.interpretation}</div>
      {doc.limitations && <div className="math-note">Limitations: {doc.limitations}</div>}
    </div>
  );
}
