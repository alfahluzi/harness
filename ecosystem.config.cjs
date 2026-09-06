module.exports = {
  apps: [
    {
      name: "frontend-dev",
      script: "npm",
      args: "run dev -- --host 0.0.0.0",
      cwd: "/home/alfahluzi/Documents/Labs/cognesia/micro-services/cognesia/frontend",
      watch: false,
      env: {
        NODE_ENV: "development",
      },
    },
  ],
};
