# @atlex/orm

> A powerful, expressive ActiveRecord ORM for building modern TypeScript applications

[![npm](https://img.shields.io/npm/v/@atlex/orm?style=flat-square&color=7c3aed)](https://www.npmjs.com/package/@atlex/orm)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-7c3aed?style=flat-square)](https://www.typescriptlang.org/)

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-yellow?style=flat-square&logo=buy-me-a-coffee)](https://buymeacoffee.com/khamazaspyan)

## Installation

```bash
npm install @atlex/orm
# or
yarn add @atlex/orm
```

## Quick Start

```typescript
import { Model } from '@atlex/orm'

export class User extends Model {
  protected table = 'users'
  protected fillable = ['name', 'email', 'age']
}

// Query the database
const users = await User.all()
const user = await User.find(1)
const activeUsers = await User.where('status', 'active').get()

// Create and save
const newUser = await User.create({
  name: 'John Doe',
  email: 'john@example.com',
  age: 30,
})

// Update and delete
await user.update({ status: 'inactive' })
await user.delete()
```

## Features

- **ActiveRecord Pattern** - Models represent database tables with intuitive API
- **Fluent Query Builder** - Build complex queries with a chainable interface
- **Relationships** - Support for hasOne, hasMany, belongsTo, belongsToMany, and more
- **Model Hooks** - Lifecycle hooks for creating, updating, and deleting models
- **Soft Deletes** - Gracefully delete records without removing them from database
- **Global Scopes** - Automatically filter queries with global scope rules
- **Eager Loading** - Load related models with the `with()` method
- **Pagination** - Built-in length-aware, simple, and cursor pagination
- **Mass Assignment** - Protect against mass assignment with fillable and guarded properties
- **Schema Builder** - Define and manage database migrations with fluent API
- **Type Safety** - Full TypeScript support with strict type checking

## Models

Models are the heart of @atlex/orm. They represent database tables and provide a fluent API for querying and manipulating data.

### Defining Models

```typescript
import { Model } from '@atlex/orm'

export class User extends Model {
  protected table = 'users'
  protected primaryKey = 'id'
  protected timestamps = true
  protected hidden = ['password']
  protected fillable = ['name', 'email', 'age']
  protected appends = ['fullName']

  // Computed attribute
  get fullName(): string {
    return `${this.getAttribute('first_name')} ${this.getAttribute('last_name')}`
  }
}

export class Post extends Model {
  protected table = 'posts'
  protected guarded = ['id', 'created_at', 'updated_at']
  protected timestamps = true
}

export class Product extends Model {
  protected table = 'products'
  protected fillable = ['name', 'price', 'description']
  protected casts = {
    price: 'decimal:2',
    is_active: 'boolean',
    metadata: 'json',
  }
}
```

### Model Properties

- `table` - Database table name (defaults to pluralized model name)
- `primaryKey` - Primary key column (defaults to 'id')
- `timestamps` - Enable automatic created_at/updated_at (defaults to true)
- `hidden` - Attributes hidden in serialization
- `fillable` - Attributes that can be mass assigned
- `guarded` - Attributes protected from mass assignment
- `appends` - Attributes to append when serializing
- `casts` - Type casting for attributes

### Querying Models

```typescript
// Get all records
const users = await User.all()

// Get with select columns
const users = await User.select('id', 'name', 'email').get()

// Find by primary key
const user = await User.find(1)

// Find or fail
const user = await User.findOrFail(1)

// Find multiple
const users = await User.findMany([1, 2, 3])

// Get first record
const user = await User.first()

// Get first record or fail
const user = await User.firstOrFail()

// Count records
const count = await User.count()

// Check existence
const exists = await User.where('email', 'john@example.com').exists()

// Get specific column values
const emails = await User.pluck('email')

// Get with default value
const user = (await User.find(1)) ?? new User()
```

### Filtering and Conditions

```typescript
// Basic where clause
const users = await User.where('status', 'active').get()
const users = await User.where('age', '>', 18).get()

// Where with operators
const users = await User.where('age', '>=', 18).get()
const users = await User.where('role', '!=', 'guest').get()
const users = await User.where('email', 'like', '%@example.com').get()

// Multiple where conditions
const users = await User.where('status', 'active')
  .where('age', '>', 18)
  .where('role', 'admin')
  .get()

// Or conditions
const users = await User.where('status', 'active').orWhere('role', 'admin').get()

// Where in array
const users = await User.whereIn('role', ['admin', 'moderator']).get()
const users = await User.whereNotIn('status', ['banned', 'suspended']).get()

// Where null
const users = await User.whereNull('deleted_at').get()
const users = await User.whereNotNull('verified_at').get()

// Where between
const users = await User.whereBetween('age', [18, 65]).get()
const users = await User.whereNotBetween('created_at', [startDate, endDate]).get()

// Raw where clause
const users = await User.whereRaw('LOWER(email) = LOWER(?)', ['john@example.com']).get()

// Where date
const users = await User.whereDate('created_at', '2024-01-15').get()

// Where year/month/day
const users = await User.whereYear('created_at', 2024).get()
const users = await User.whereMonth('created_at', 1).get()
const users = await User.whereDay('created_at', 15).get()
```

### Ordering and Limiting

```typescript
// Order by ascending
const users = await User.orderBy('created_at', 'asc').get()

// Order by descending
const users = await User.orderBy('name', 'desc').get()

// Latest (order by created_at descending)
const users = await User.latest().get()
const users = await User.latest('updated_at').get()

// Oldest (order by created_at ascending)
const users = await User.oldest().get()

// Random order
const users = await User.inRandomOrder().get()

// Multiple order by
const users = await User.orderBy('role', 'asc').orderBy('name', 'asc').get()

// Limit and offset
const users = await User.limit(10).get()
const users = await User.limit(10).offset(20).get()

// Take (alias for limit)
const users = await User.take(5).get()

// Skip (alias for offset)
const users = await User.skip(10).take(5).get()
```

### Aggregations

```typescript
// Count records
const count = await User.count()
const count = await User.where('status', 'active').count()

// Get max value
const maxAge = await User.max('age')

// Get min value
const minAge = await User.min('age')

// Get sum
const totalAmount = await Order.sum('amount')

// Get average
const avgPrice = await Product.avg('price')

// Get specific columns
const stats = await User.select('role').count().groupBy('role').get()
```

### Distinct Results

```typescript
// Get distinct records
const roles = await User.distinct('role').pluck('role')

// Distinct with select
const results = await User.distinct().select('city', 'country').get()
```

### Creating and Saving

```typescript
// Create via constructor and save
const user = new User()
user.name = 'John Doe'
user.email = 'john@example.com'
await user.save()

// Create via create method (mass assignment)
const user = await User.create({
  name: 'Jane Doe',
  email: 'jane@example.com',
  age: 25,
})

// Create multiple
const users = await User.createMany([
  { name: 'User 1', email: 'user1@example.com' },
  { name: 'User 2', email: 'user2@example.com' },
])

// First or create
const user = await User.firstOrCreate({ email: 'john@example.com' }, { name: 'John Doe', age: 30 })

// Update or create
const user = await User.updateOrCreate({ email: 'john@example.com' }, { name: 'John Doe', age: 31 })

// Insert raw (no model instantiation)
await User.insert({
  name: 'Bulk User',
  email: 'bulk@example.com',
  created_at: new Date(),
})

// Insert many
await User.insertMany([
  { name: 'User 1', email: 'user1@example.com' },
  { name: 'User 2', email: 'user2@example.com' },
])
```

### Updating and Deleting

```typescript
// Update single model
const user = await User.find(1)
user.status = 'inactive'
await user.save()

// Update via method
const user = await User.find(1)
await user.update({ status: 'inactive', email: 'new@example.com' })

// Update query result
const updated = await User.where('status', 'pending').update({ status: 'approved' })

// Increment/decrement
await User.find(1).increment('login_count')
await User.find(1).decrement('remaining_days')
await User.find(1).increment('points', 10)

// Delete single model
const user = await User.find(1)
await user.delete()

// Delete query result
const deleted = await User.where('status', 'inactive').delete()

// Force delete (soft deleted records)
await user.forceDelete()

// Restore soft deleted
await user.restore()
```

## Relationships

Define relationships between models using fluent API.

### One-to-One (hasOne)

```typescript
export class User extends Model {
  profile() {
    return this.hasOne(Profile, 'user_id', 'id')
  }
}

export class Profile extends Model {
  user() {
    return this.belongsTo(User, 'user_id', 'id')
  }
}

// Usage
const user = await User.find(1)
const profile = await user.profile().first()

// Eager load
const users = await User.with('profile').get()
```

### One-to-Many (hasMany)

```typescript
export class User extends Model {
  posts() {
    return this.hasMany(Post, 'user_id', 'id')
  }
}

export class Post extends Model {
  author() {
    return this.belongsTo(User, 'user_id', 'id')
  }
}

// Usage
const user = await User.find(1)
const posts = await user.posts().get()

// Eager load
const users = await User.with('posts').get()

// Create related model
const post = await user.posts().create({
  title: 'New Post',
  content: 'Content here',
})
```

### Many-to-Many (belongsToMany)

```typescript
export class User extends Model {
  roles() {
    return this.belongsToMany(
      Role,
      'user_roles', // pivot table
      'user_id', // foreign key on pivot
      'role_id', // other foreign key on pivot
    )
  }
}

export class Role extends Model {
  users() {
    return this.belongsToMany(User, 'user_roles', 'role_id', 'user_id')
  }
}

// Usage
const user = await User.find(1)
const roles = await user.roles().get()

// Attach relationship
await user.roles().attach(roleId)
await user.roles().attach([roleId1, roleId2])

// Attach with pivot data
await user.roles().attach(roleId, { assigned_by: 'admin' })

// Detach relationship
await user.roles().detach(roleId)
await user.roles().detach([roleId1, roleId2])

// Sync relationships
await user.roles().sync([roleId1, roleId2])

// Toggle relationships
await user.roles().toggle(roleId)

// Access pivot data
const roles = await user.roles().get()
roles.forEach((role) => {
  console.log(role.pivot.assigned_by)
})
```

### Has Many Through (hasManyThrough)

```typescript
export class User extends Model {
  comments() {
    return this.hasManyThrough(Comment, Post, 'user_id', 'post_id')
  }
}

// Usage
const user = await User.find(1)
const comments = await user.comments().get()
```

### Has One Through (hasOneThrough)

```typescript
export class User extends Model {
  latestPost() {
    return this.hasOneThrough(Post, User, 'id', 'user_id')
  }
}
```

## Eager Loading

Eager load related models to avoid N+1 queries.

```typescript
// With single relationship
const users = await User.with('profile').get()

// With multiple relationships
const users = await User.with('profile', 'posts', 'roles').get()

// With nested relationships
const users = await User.with('posts.comments').get()

// With count of related models
const users = await User.withCount('posts').get()

// With custom count
const users = await User.withCount({
  posts: (query) => query.where('published', true),
}).get()

// Lazy eager loading
const users = await User.all()
await User.with('profile').loadMissing(users)
```

## Model Hooks

Hook into model lifecycle events.

```typescript
export class User extends Model {
  protected static booted = false

  static boot() {
    if (this.booted) return

    // Before creating
    this.creating((model) => {
      console.log('User creating:', model.name)
    })

    // After creating
    this.created((model) => {
      console.log('User created:', model.id)
    })

    // Before updating
    this.updating((model) => {
      console.log('User updating:', model.id)
    })

    // After updating
    this.updated((model) => {
      console.log('User updated:', model.id)
    })

    // Before saving (both create and update)
    this.saving((model) => {
      model.email = model.email.toLowerCase()
    })

    // After saving
    this.saved((model) => {
      console.log('User saved:', model.id)
    })

    // Before deleting
    this.deleting((model) => {
      console.log('User deleting:', model.id)
    })

    // After deleting
    this.deleted((model) => {
      console.log('User deleted:', model.id)
    })

    this.booted = true
  }
}
```

## Global Scopes

Automatically filter queries with global scope rules.

```typescript
export class User extends Model {
  protected static booted = false

  static boot() {
    this.addGlobalScope('active', (query) => {
      return query.where('status', 'active')
    })

    this.booted = true
  }
}

// Usage
const users = await User.all() // Only active users

// Bypass global scope
const users = await User.withoutGlobalScope('active').get()
const users = await User.withoutGlobalScopes().get()
```

## Query Scopes

Reusable query filters using scopes.

```typescript
export class User extends Model {
  // Define scope
  scope_active(query) {
    return query.where('status', 'active')
  }

  scope_admins(query) {
    return query.where('role', 'admin')
  }

  scope_createdBetween(query, startDate, endDate) {
    return query.whereBetween('created_at', [startDate, endDate])
  }
}

// Usage
const users = await User.active().get()
const admins = await User.admins().get()
const recentUsers = await User.createdBetween(startDate, endDate).active().get()
```

## Model Observers

Observe multiple models with a single observer class.

```typescript
export class UserObserver {
  creating(user: User) {
    console.log('Creating user:', user.name)
  }

  created(user: User) {
    console.log('Created user:', user.id)
  }

  updating(user: User) {
    console.log('Updating user:', user.id)
  }

  updated(user: User) {
    console.log('Updated user:', user.id)
  }

  deleting(user: User) {
    console.log('Deleting user:', user.id)
  }

  deleted(user: User) {
    console.log('Deleted user:', user.id)
  }
}

// Register observer
User.observe(UserObserver)
```

## Soft Deletes

Gracefully delete records without removing them from database.

```typescript
import { Model, SoftDeletes } from '@atlex/orm'

export class User extends Model {
  use(SoftDeletes)

  protected dates = ['deleted_at']
}

// Usage
const user = await User.find(1)
await user.delete() // Sets deleted_at timestamp

// Query includes soft deleted records
const users = await User.all()

// Get only soft deleted
const deleted = await User.onlyTrashed().get()

// Include soft deleted
const users = await User.withTrashed().get()

// Permanently delete
await user.forceDelete()

// Restore
await user.restore()
```

## Pagination

Paginate query results easily.

```typescript
// Length-aware pagination
const users = await User.paginate(15, 1) // 15 per page, page 1
const pagination = users // LengthAwarePaginator instance

pagination.data() // Array of users
pagination.currentPage() // 1
pagination.perPage() // 15
pagination.total() // Total count
pagination.lastPage() // Last page number
pagination.hasPages() // true/false
pagination.hasMorePages() // true/false
pagination.links() // Pagination links

// Simple pagination (no total count)
const users = await User.simplePaginate(15, 1)

// Cursor pagination
const users = await User.cursorPaginate(15)
users.cursor() // Cursor for next page
users.getPathQueryString() // Query string
```

## Joins

Join tables in queries.

```typescript
// Inner join
const users = await User.join('posts', 'users.id', 'posts.user_id')
  .select('users.name', 'posts.title')
  .get()

// Left join
const users = await User.leftJoin('posts', 'users.id', 'posts.user_id').get()

// Join with where
const users = await User.leftJoin('posts', 'users.id', 'posts.user_id')
  .where('posts.published', true)
  .get()

// Raw join
const users = await User.joinRaw('left join posts on users.id = posts.user_id').get()
```

## Grouping and Having

Group and filter grouped results.

```typescript
// Group by
const grouped = await User.select('role', User.raw('COUNT(*) as count')).groupBy('role').get()

// Having clause
const results = await User.select('role', User.raw('COUNT(*) as count'))
  .groupBy('role')
  .having('count', '>', 5)
  .get()

// Having raw
const results = await User.groupBy('role').havingRaw('COUNT(*) > 5').get()
```

## Database Migrations

Define database schema with fluent API.

```typescript
import { Schema, Blueprint } from '@atlex/orm'

// Create table
await Schema.create('users', (table: Blueprint) => {
  table.increments('id')
  table.string('name')
  table.string('email').unique()
  table.string('password')
  table.string('phone').nullable()
  table.enum('role', ['admin', 'user', 'guest']).default('user')
  table.boolean('is_active').default(true)
  table.json('metadata').nullable()
  table.timestamps()
})

// Modify table
await Schema.table('users', (table: Blueprint) => {
  table.string('avatar').nullable()
  table.softDeletes()
})

// Drop table
await Schema.dropIfExists('users')
```

### Column Types

```typescript
// Numeric
table.increments('id') // Auto-incrementing integer
table.bigIncrements('id') // Big auto-incrementing integer
table.integer('age') // Integer
table.bigInteger('views') // Big integer
table.smallInteger('level') // Small integer
table.decimal('price', 8, 2) // Decimal with precision
table.float('rating') // Float
table.double('value') // Double

// String
table.string('name') // VARCHAR
table.string('email', 100) // VARCHAR with length
table.text('description') // TEXT
table.longText('content') // LONGTEXT
table.char('code', 2) // CHAR
table.enum('status', ['a', 'b']) // ENUM

// Date/Time
table.date('birthday') // DATE
table.dateTime('published_at') // DATETIME
table.timestamp('created_at') // TIMESTAMP
table.timestamps() // created_at, updated_at
table.softDeletes() // deleted_at for soft deletes

// JSON
table.json('metadata') // JSON

// Boolean
table.boolean('is_active') // BOOLEAN

// Binary
table.binary('data') // BINARY

// Nullable
table.string('phone').nullable()

// Default value
table.string('role').default('user')

// Unique
table.string('email').unique()

// Index
table.string('username').index()

// Foreign key
table.foreign('user_id').references('id').on('users')
```

### Modifiers

```typescript
table.string('email').unique().nullable()
table.integer('age').default(0).unsigned()
table.string('status').default('active').index()
table.bigInteger('count').unsigned().default(0)
table.timestamps().nullable()
```

## Connection Registry

Manage multiple database connections.

```typescript
import { ConnectionRegistry } from '@atlex/orm'

const registry = new ConnectionRegistry({
  default: 'postgres',
  connections: {
    postgres: {
      driver: 'postgres',
      host: 'localhost',
      port: 5432,
      database: 'myapp',
      user: 'postgres',
      password: 'password',
    },
    mysql: {
      driver: 'mysql',
      host: 'localhost',
      port: 3306,
      database: 'myapp',
      user: 'root',
      password: 'password',
    },
  },
})

// Get connection
const connection = registry.connection('postgres')

// Use different connection in model
export class AnalyticsUser extends User {
  protected connection = 'mysql'
}
```

## API Overview

### Model Static Methods

| Method                             | Description               |
| ---------------------------------- | ------------------------- |
| `query()`                          | Start a new query builder |
| `where(column, operator?, value?)` | Filter records            |
| `all()`                            | Get all records           |
| `find(id)`                         | Find by primary key       |
| `findOrFail(id)`                   | Find or throw exception   |
| `findMany(ids)`                    | Find multiple records     |
| `create(attributes)`               | Create and save           |
| `firstOrCreate(where, create?)`    | First or create           |
| `updateOrCreate(where, update)`    | Update or create          |
| `paginate(perPage, page)`          | Paginate results          |
| `simplePaginate(perPage, page)`    | Simple pagination         |
| `cursorPaginate(perPage)`          | Cursor pagination         |
| `with(...relations)`               | Eager load relations      |
| `withCount(...relations)`          | Count relations           |
| `observe(observer)`                | Register observer         |
| `scope(name, callback)`            | Define scope              |
| `addGlobalScope(name, callback)`   | Add global scope          |

### Model Instance Methods

| Method                      | Description                |
| --------------------------- | -------------------------- |
| `save()`                    | Save model to database     |
| `update(attributes)`        | Update and save            |
| `delete()`                  | Soft delete                |
| `forceDelete()`             | Permanently delete         |
| `restore()`                 | Restore soft deleted       |
| `fresh()`                   | Reload from database       |
| `getAttribute(name)`        | Get attribute value        |
| `setAttribute(name, value)` | Set attribute value        |
| `hasOne(...args)`           | Define one-to-one          |
| `hasMany(...args)`          | Define one-to-many         |
| `belongsTo(...args)`        | Define inverse one-to-many |
| `belongsToMany(...args)`    | Define many-to-many        |

### QueryBuilder Methods

| Method                              | Description          |
| ----------------------------------- | -------------------- |
| `select(...columns)`                | Select columns       |
| `where(column, operator?, value?)`  | WHERE clause         |
| `whereIn(column, values)`           | WHERE IN clause      |
| `whereNull(column)`                 | WHERE NULL clause    |
| `whereBetween(column, range)`       | WHERE BETWEEN clause |
| `whereRaw(raw, bindings?)`          | Raw WHERE clause     |
| `join(table, on)`                   | INNER JOIN           |
| `leftJoin(table, on)`               | LEFT JOIN            |
| `groupBy(...columns)`               | GROUP BY             |
| `having(column, operator?, value?)` | HAVING clause        |
| `orderBy(column, direction?)`       | ORDER BY             |
| `latest(column?)`                   | ORDER BY DESC        |
| `oldest(column?)`                   | ORDER BY ASC         |
| `limit(count)`                      | LIMIT                |
| `offset(count)`                     | OFFSET               |
| `distinct()`                        | DISTINCT             |
| `count()`                           | COUNT aggregate      |
| `max(column)`                       | MAX aggregate        |
| `min(column)`                       | MIN aggregate        |
| `sum(column)`                       | SUM aggregate        |
| `avg(column)`                       | AVG aggregate        |
| `get()`                             | Get all results      |
| `first()`                           | Get first result     |
| `firstOrFail()`                     | Get first or fail    |
| `find(id)`                          | Find by primary key  |
| `create(attributes)`                | Create record        |
| `insert(attributes)`                | Insert record        |
| `update(attributes)`                | Update records       |
| `delete()`                          | Delete records       |
| `paginate(perPage, page)`           | Paginate             |
| `with(...relations)`                | Eager load           |
| `withCount(...relations)`           | Count relations      |

### Pagination Classes

| Class                  | Description                |
| ---------------------- | -------------------------- |
| `LengthAwarePaginator` | Full pagination with total |
| `Paginator`            | Simple pagination          |
| `CursorPaginator`      | Cursor-based pagination    |

## Exceptions

| Exception                 | Description                 |
| ------------------------- | --------------------------- |
| `ModelNotFoundException`  | Model not found             |
| `MassAssignmentException` | Mass assignment not allowed |
| `QueryException`          | Database query error        |

## Configuration

Configure database connections through environment variables.

```typescript
// .env
DB_CONNECTION = postgres
DB_HOST = localhost
DB_PORT = 5432
DB_DATABASE = myapp
DB_USER = postgres
DB_PASSWORD = secret

// config/database.ts
export default {
  default: process.env.DB_CONNECTION,
  connections: {
    postgres: {
      driver: 'postgres',
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_DATABASE,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
    },
  },
}
```

## Documentation

For detailed documentation, examples, and API reference, visit the [Atlex documentation](https://atlex.dev/docs).

## License

MIT
