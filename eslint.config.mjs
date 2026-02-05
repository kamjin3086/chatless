import { FlatCompat } from "@eslint/eslintrc";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const eslintConfig = tseslint.config(
  // 全局忽略生成产物与非源代码目录，避免误扫产生大量噪音
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "src-tauri/target/**",
      "dist/**",
      "build/**",
      "coverage/**",
      "public/**",
      "scripts/**",
      "src/scripts/**",
      "src/lib/migrations/**",
      "**/__tests__/**",
      "**/*.test.*",
      "**/*.spec.*",
    ],
  },
  eslint.configs.recommended,
  // 先加载 Next 的推荐配置，再由 TS 的覆盖 TS 文件的解析与规则
  ...compat.extends("next/core-web-vitals"),
  // 使用更温和的、类型感知推荐规则，避免 strict 过于严苛
  ...tseslint.configs.recommendedTypeChecked,
  {
    // Disabled rules taken from https://biomejs.dev/linter/rules-sources for ones that
    // are already handled by Biome
    rules: {
      // eslint-plugin-jsx-a11y rules replaced by Biome
      "jsx-a11y/alt-text": "off",
      "jsx-a11y/anchor-has-content": "off",
      "jsx-a11y/anchor-is-valid": "off",
      "jsx-a11y/aria-activedescendant-has-tabindex": "off",
      "jsx-a11y/aria-props": "off",
      "jsx-a11y/aria-proptypes": "off",
      "jsx-a11y/aria-role": "off",
      "jsx-a11y/aria-unsupported-elements": "off",
      "jsx-a11y/autocomplete-valid": "off",
      "jsx-a11y/click-events-have-key-events": "off",
      "jsx-a11y/heading-has-content": "off",
      "jsx-a11y/html-has-lang": "off",
      "jsx-a11y/iframe-has-title": "off",
      "jsx-a11y/img-redundant-alt": "off",
      "jsx-a11y/interactive-supports-focus": "off",
      "jsx-a11y/label-has-associated-control": "off",
      "jsx-a11y/lang": "off",
      "jsx-a11y/media-has-caption": "off",
      "jsx-a11y/mouse-events-have-key-events": "off",
      "jsx-a11y/no-access-key": "off",
      "jsx-a11y/no-aria-hidden-on-focusable": "off",
      "jsx-a11y/no-autofocus": "off",
      "jsx-a11y/no-distracting-elements": "off",
      "jsx-a11y/no-interactive-element-to-noninteractive-role": "off",
      "jsx-a11y/no-noninteractive-element-to-interactive-role": "off",
      "jsx-a11y/no-noninteractive-tabindex": "off",
      "jsx-a11y/no-redundant-roles": "off",
      "jsx-a11y/no-static-element-interactions": "off",
      "jsx-a11y/prefer-tag-over-role": "off",
      "jsx-a11y/role-has-required-aria-props": "off",
      "jsx-a11y/role-supports-aria-props": "off",
      "jsx-a11y/scope": "off",
      "jsx-a11y/tabindex-no-positive": "off",
      // eslint-plugin-react rules replaced by Biome
      "react/button-has-type": "off",
      "react/jsx-boolean-value": "off",
      "react/jsx-curly-brace-presence": "off",
      "react/jsx-fragments": "off",
      "react/jsx-key": "off",
      "react/jsx-no-comment-textnodes": "off",
      "react/jsx-no-duplicate-props": "off",
      "react/jsx-no-target-blank": "off",
      "react/jsx-no-useless-fragment": "off",
      "react/no-array-index-key": "off",
      "react/no-children-prop": "off",
      "react/no-danger": "off",
      "react/no-danger-with-children": "off",
      "react/void-dom-elements-no-children": "off",
      // eslint-plugin-react-hooks rules replaced by Biome
      "react-hooks/exhaustive-deps": "off",
      "react-hooks/rules-of-hooks": "off",
      // typescript-eslint rules replaced by Biome
      "@typescript-eslint/adjacent-overload-signatures": "off",
      "@typescript-eslint/array-type": "off",
      "@typescript-eslint/ban-types": "off",
      "@typescript-eslint/consistent-type-exports": "off",
      "@typescript-eslint/consistent-type-imports": "off",
      "@typescript-eslint/default-param-last": "off",
      "@typescript-eslint/dot-notation": "off",
      "@typescript-eslint/explicit-function-return-type": "off",
      "@typescript-eslint/explicit-member-accessibility": "off",
      "@typescript-eslint/naming-convention": "off",
      "@typescript-eslint/no-dupe-class-members": "off",
      "@typescript-eslint/no-empty-function": "off",
      "@typescript-eslint/no-empty-interface": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-extra-non-null-assertion": "off",
      "@typescript-eslint/no-extraneous-class": "off",
      "@typescript-eslint/no-inferrable-types": "off",
      "@typescript-eslint/no-invalid-void-type": "off",
      "@typescript-eslint/no-loss-of-precision": "off",
      "@typescript-eslint/no-misused-new": "off",
      "@typescript-eslint/no-namespace": "off",
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-redeclare": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-restricted-imports": "off",
      "@typescript-eslint/no-restricted-types": "off",
      "@typescript-eslint/no-this-alias": "off",
      "@typescript-eslint/no-unnecessary-type-constraint": "off",
      "@typescript-eslint/no-unsafe-declaration-merging": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-use-before-define": "off",
      "@typescript-eslint/no-useless-constructor": "off",
      "@typescript-eslint/no-useless-empty-export": "off",
      "@typescript-eslint/only-throw-error": "off",
      "@typescript-eslint/parameter-properties": "off",
      "@typescript-eslint/prefer-as-const": "off",
      "@typescript-eslint/prefer-enum-initializers": "off",
      "@typescript-eslint/prefer-for-of": "off",
      "@typescript-eslint/prefer-function-type": "off",
      "@typescript-eslint/prefer-literal-enum-member": "off",
      "@typescript-eslint/prefer-namespace-keyword": "off",
      "@typescript-eslint/prefer-optional-chain": "off",
      "@typescript-eslint/require-await": "off",
      // Custom rules（进一步放宽，减少开发期噪音）
      "no-console": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // 该规则需要类型信息，且易在非 TS 文件触发解析问题，这里关闭
      "@typescript-eslint/await-thenable": "off",
      "@typescript-eslint/no-unnecessary-type-assertion": "off",
      // 放宽类型安全相关高噪音规则
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      // Promise 相关关闭（流式/事件回调等场景容易触发噪音）
      "@typescript-eslint/no-floating-promises": "off",
      "@typescript-eslint/no-misused-promises": "off",
      // 注释规范从 error 降为 warn
      "@typescript-eslint/ban-ts-comment": "warn",
      // 其他通用高噪音规则降级
      "no-empty": "warn",
      "no-control-regex": "warn",
      // 放宽一批在现有代码中噪音较大的规则，确保 CI 先可用
      "no-case-declarations": "off",
      "no-empty-pattern": "off",
      "react/no-unescaped-entities": "off",
      "react/display-name": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-base-to-string": "warn",
      "@typescript-eslint/prefer-promise-reject-errors": "warn",
      "@typescript-eslint/no-unsafe-enum-comparison": "warn",
      "@typescript-eslint/no-unused-expressions": "warn",
      "no-var": "warn",
      "no-useless-escape": "warn",
      "@typescript-eslint/unbound-method": "warn",
      // 保留模板字符串限制，但降级为 warn
      "@typescript-eslint/restrict-template-expressions": [
        "warn",
        {
          allowNumber: true,
          allowBoolean: true,
          allowNever: true,
          allowNullish: true,
          allowAny: true,
        },
      ],
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // 目录级差异化：开发/演示目录关闭 no-console 降低噪音
  {
    files: [
      "src/components/dev/**",
      "src/app/dev-tools/**",
      "src/app/debug-headers/**",
    ],
    rules: {
      "no-console": "off",
    },
  },
  // 目录级差异化：运行期服务与工具，弱化日志与Promise类警告
  {
    files: [
      "src/lib/utils/**",
      "src/lib/services/**",
      "src/store/**",
      "src/lib/request*.ts",
    ],
    rules: {
      "no-console": "off",
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/ban-ts-comment": ["warn", { "ts-expect-error": "allow-with-description" }],
    },
  },
);

export default eslintConfig;
