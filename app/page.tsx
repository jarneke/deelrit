export default function Home() {
  return (
    <main className="min-h-screen bg-slate-50 px-6 py-10 text-slate-900">
      <div className="mx-auto max-w-3xl">
        <header className="mb-10 flex items-center justify-between">
          <span className="text-2xl font-bold tracking-tight">
            deel<span className="text-blue-600">rit.</span>
          </span>
          <span className="text-sm text-slate-500">Jij & je zus</span>
        </header>

        <h1 className="text-3xl font-semibold tracking-tight">
          Alles op een rij.
        </h1>
        <p className="mt-2 text-slate-500">
          Jullie auto, kilometers en kosten op één plek.
        </p>

        <section className="mt-8 rounded-2xl bg-blue-950 p-6 text-white">
          <h2 className="text-sm text-blue-200">Onderling saldo</h2>
          <p className="mt-3 text-4xl font-semibold">Nog geen afrekening</p>
          <p className="mt-3 text-sm text-blue-200">
            Voeg eerst jullie startkilometerstand en volle tank toe.
          </p>
        </section>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="font-semibold">Ritten</h2>
            <p className="mt-2 text-sm text-slate-500">
              Wie reed wanneer en hoeveel kilometer?
            </p>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="font-semibold">Tankbeurten</h2>
            <p className="mt-2 text-sm text-slate-500">
              Volle tanks, bedragen en wie betaalde.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}
