// Placeholder shell (T0.02). The real app shell, routing and first-run setup arrive in T0.19 and T1.24.
// The app ships blank (LIB-12): no courses, subjects or sample content, ever.

export function App() {
  return (
    <main className="mx-auto flex min-h-screen max-w-[68ch] flex-col justify-center gap-4 px-6">
      <h1 className="text-[2.125rem] leading-tight font-semibold text-text">Studypoint</h1>
      <p className="reading text-text-2">
        Studypoint is being built. Once it's ready, you'll choose your school and add your first course from your own
        files, links and lookups.
      </p>
    </main>
  );
}
