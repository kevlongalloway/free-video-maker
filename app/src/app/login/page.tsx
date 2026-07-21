// Skeleton login / signup page.
// TODO: Wire up authentication. On submit this form should call the /api
// service (see NEXT_PUBLIC_API_URL) to authenticate or register the user,
// store the returned session/token, and redirect to the dashboard. Right now
// the form is a non-functional placeholder and does not submit anywhere.

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-lg border border-gray-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-bold tracking-tight">
          Sign in to Free Video Maker
        </h1>
        <p className="mt-1 text-sm text-gray-500">
          Placeholder form — auth is not wired up yet.
        </p>

        {/* Non-functional skeleton form */}
        <form className="mt-6 space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700"
            >
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>

          <button
            type="submit"
            className="w-full rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}
