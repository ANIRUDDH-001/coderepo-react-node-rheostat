import { Component } from "react";
import { clientLogger } from "../logging/client-logger.js";
import { EmptyState } from "./EmptyState.jsx";
import { MaterialIcon } from "./MaterialIcon.jsx";

// Catches render errors below it; `resetKeys` clears the error when any key changes (the route path).
export class ErrorBoundary extends Component {
	state = { error: null };
	static getDerivedStateFromError(error) {
		return { error };
	}
	componentDidCatch(error, info) {
		clientLogger.error("render.failed", { message: error.message, componentStack: info?.componentStack });
		this.props.onError?.(error, info);
	}
	componentDidUpdate(previous) {
		const keys = this.props.resetKeys || [];
		const before = previous.resetKeys || [];
		if (this.state.error && (keys.length !== before.length || keys.some((key, index) => key !== before[index]))) this.reset();
	}
	reset = () => this.setState({ error: null });
	render() {
		return this.state.error ? this.props.fallback(this.state.error, this.reset) : this.props.children;
	}
}

export function RouteErrorFallback({ error, onRetry, projectKey }) {
	return (
		<section className="page" aria-labelledby="route-error-title">
			<EmptyState
				action={{ label: "Try again", onClick: onRetry }}
				description={`${error.message}. Your other pages are unaffected.`}
				icon="error_outline"
				id="route-error-title"
				title="This page ran into a problem"
			/>
			<p className="route-error-links">
				<a href={`/projects/${projectKey}/dashboard`}>Go to dashboard</a>
			</p>
		</section>
	);
}

export function AppErrorFallback({ error }) {
	return (
		<main className="app-error" role="alert">
			<MaterialIcon size={40}>error_outline</MaterialIcon>
			<h1>Rheostat hit an unexpected error</h1>
			<p>{error.message}</p>
			<button className="primary-button" type="button" onClick={() => window.location.reload()}>
				Reload Rheostat
			</button>
		</main>
	);
}
