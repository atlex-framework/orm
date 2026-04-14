/**
 * Base class for database seeders. Subclass, implement {@link run}, and `export default` the class.
 * Run with `atlex db:seed --class=YourSeeder`.
 */
export abstract class Seeder {
  /**
   * Seed the application's database.
   */
  public abstract run(): void | Promise<void>

  /**
   * Run another seeder class by constructor reference.
   *
   * @param SeederClass - Seeder constructor (typically the module’s default export).
   */
  protected async call(SeederClass: new () => Seeder): Promise<void> {
    const instance = new SeederClass()
    await instance.run()
  }
}
