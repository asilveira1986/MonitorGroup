/**
 * Mostrado na hora ao clicar num menu, enquanto a tela é montada no servidor: o clique responde
 * imediatamente (antes, nada mudava até os dados chegarem).
 */
export default function Loading() {
  return (
    <div data-loading aria-busy="true" aria-label="Carregando" className="animate-pulse">
      <div className="mb-6 space-y-2">
        <div className="h-7 w-56 rounded-lg bg-surface-2" />
        <div className="h-4 w-full max-w-xl rounded bg-surface-2/70" />
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-2xl border border-line bg-surface" />
        ))}
      </div>
      <div className="mt-4 h-72 rounded-2xl border border-line bg-surface" />
    </div>
  );
}
