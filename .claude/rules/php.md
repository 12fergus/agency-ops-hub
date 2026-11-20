---
paths:
  - "**/*.php"
---

# PHP rules

- Runtime: PHP/MySQL from Laragon (`C:\laragon`). Check `composer.json` for the PHP version constraint before using newer syntax.
- `declare(strict_types=1);` in new files; typed properties, params and return types.
- PSR-12 style; php-cs-fixer runs automatically via hook if `vendor/bin/php-cs-fixer` exists.
- Laravel (if present): use migrations for schema changes, Form Requests for validation, Eloquent/query builder over raw SQL. Migrations are destructive-adjacent — explain before running.
- After changing classes/namespaces: `composer dump-autoload`.
