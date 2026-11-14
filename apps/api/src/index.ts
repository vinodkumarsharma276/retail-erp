import { buildApp } from './app.js';
import { config, productionConfigProblems } from './config/index.js';

async function main() {
  const problems = productionConfigProblems(process.env);
  if (problems.length > 0) {
    console.error(`Refusing to start in production:\n- ${problems.join('\n- ')}`);
    process.exit(1);
  }

  const app = await buildApp();

  try {
    await app.listen({ port: config.port, host: config.host });
    console.log(`RetailERP API running at http://${config.host}:${config.port}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
