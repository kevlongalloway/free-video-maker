// Skeleton authenticated dashboard landing page.
// NOTE: These are placeholder UI elements only. Authentication is NOT wired up
// yet — there is no session check, and the avatar / sign-out button and cards
// are non-functional skeletons. Real auth + data fetching (against the /api
// service) is TODO.

const cards = [
  {
    title: "Create new video",
    description: "Start a new video generation from a prompt or template.",
  },
  {
    title: "My videos",
    description: "Browse, manage, and download videos you've generated.",
  },
  {
    title: "Account",
    description: "Manage your profile, plan, and API usage.",
  },
];

export default function DashboardPage() {
  return (
    <div className="min-h-screen">
      {/* Top navigation bar (placeholder) */}
      <nav className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4">
        <span className="text-lg font-semibold tracking-tight">
          Free Video Maker
        </span>
        <div className="flex items-center gap-4">
          {/* Placeholder user avatar */}
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-sm font-medium text-indigo-700">
            U
          </div>
          {/* Placeholder sign-out button (not wired yet) */}
          <button
            type="button"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Sign out
          </button>
        </div>
      </nav>

      {/* Main content */}
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome back
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          This is a skeleton dashboard. Nothing here is wired up yet.
        </p>

        {/* Grid of placeholder cards */}
        <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => (
            <div
              key={card.title}
              className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm transition hover:shadow-md"
            >
              <h2 className="text-base font-semibold">{card.title}</h2>
              <p className="mt-2 text-sm text-gray-500">{card.description}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
