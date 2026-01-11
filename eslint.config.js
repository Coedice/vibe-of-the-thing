export default [
  {
    ignores: [
      "node_modules/**",
      "_site/**",
      ".bundle/**",
      "vendor/**",
      ".jekyll-cache/**",
      "**/*.scss",
      "**/*.css"
      ,
      "tools/parliament-kanban/script.js"
    ]
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        global: "readonly",
        setImmediate: "readonly",
        setInterval: "readonly",
        setTimeout: "readonly"
      }
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-console": "off",
      "semi": ["error", "always"],
      "quotes": ["error", "double", { avoidEscape: true }],
      "comma-dangle": ["error", "never"],
      "indent": ["error", 2]
    }
  }
];
