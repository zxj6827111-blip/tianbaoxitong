module.exports = {
    apps: [{
        name: "gov-budget-report",
        script: "./src/index.js",
        instances: "max",
        exec_mode: "cluster",
        env: {
            NODE_ENV: "production",
            PORT: 3000
        },
        merge_logs: true,
        log_date_format: "YYYY-MM-DD HH:mm:ss Z",
        max_memory_restart: "1G"
    }]
};
