// Marca d'agua fixa no fundo da pagina, atras do conteudo - usada tanto no login
// quanto no shell autenticado (Layout).
export function Watermark() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 flex items-center justify-center">
      <img
        src="/background.png"
        alt=""
        className="w-[420px] max-w-[70vw] opacity-[0.04] dark:opacity-[0.08]"
      />
    </div>
  );
}
