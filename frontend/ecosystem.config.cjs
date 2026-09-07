module.exports = {
	apps: [
		{
			name: "harness-labs",
			script: "npm",
			args: "run dev -- --host 0.0.0.0",
			cwd: "/home/alfahluzi/Documents/Labs/Puna/micro-services/Puna/frontend",
			watch: false,
			env: {
				NODE_ENV: "development",
			},
		},
	],
};
