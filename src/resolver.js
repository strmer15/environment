import { basename, join, relative } from 'node:path';
import { realpathSync } from 'node:fs';
import createdLogger from 'debug';
import { asNamespace } from './util/namespace.js';
import { lookupGenerators } from './generator-lookup.js';

const debug = createdLogger('yeoman:environment');

/**
 * @mixin
 * @alias env/resolver
 */
const resolver = {};
export default resolver;

/**
 * Search for generators and their sub generators.
 *
 * A generator is a `:lookup/:name/index.js` file placed inside an npm package.
 *
 * Defaults lookups are:
 *   - ./
 *   - generators/
 *   - lib/generators/
 *
 * So this index file `node_modules/generator-dummy/lib/generators/yo/index.js` would be
 * registered as `dummy:yo` generator.
 *
 * @param {boolean|Object} [options]
 * @param {boolean} [options.localOnly = false] - Set true to skip lookups of
 *                                               globally-installed generators.
 * @param {string|Array} [options.packagePaths] - Paths to look for generators.
 * @param {string|Array} [options.npmPaths] - Repository paths to look for generators packages.
 * @param {string|Array} [options.filePatterns='*\/index.js'] - File pattern to look for.
 * @param {string|Array} [options.packagePatterns='generator-*'] - Package pattern to look for.
 * @param {boolean}      [options.singleResult=false] - Set true to stop lookup on the first match.
 * @param {Number}       [options.globbyDeep] - Deep option to be passed to globby.
 * @return {Promise<Object[]>} List of generators
 */
resolver.lookup = async function (options) {
  // Resolve signature where options is omitted.
  if (typeof options === 'function') {
    throw new TypeError('Callback support have been removed.');
    // Resolve signature where options is boolean.
  } else if (typeof options === 'boolean') {
    options = { localOnly: options };
  } else {
    options = options || { localOnly: false };
  }

  const { registerToScope, lookups = this.lookups } = options;
  options = {
    ...options,
    lookups,
  };

  const generators = [];
  await lookupGenerators(options, module => {
    const { packagePath, filePath, lookups } = module;

    const meta = _tryRegistering({ registerToScope, env: this, filePath, packagePath, lookups });
    if (meta) {
      generators.push({
        ...meta,
        generatorPath: meta.resolved,
        registered: true,
      });

      return options.singleResult;
    }

    generators.push({
      generatorPath: filePath,
      resolved: filePath,
      packagePath,
      registered: false,
    });

    return false;
  });

  return generators;
};

/**
 * Try registering a Generator to this environment.
 *
 * @private
 *
 * @param  {String} generatorReference A generator reference, usually a file path.
 * @param  {String} [packagePath] - Generator's package path.
 * @param  {String} [namespace] - namespace of the generator.
 * @return {boolean} true if the generator have been registered.
 */
function _tryRegistering({ env, registerToScope, filePath, packagePath, lookups }) {
  try {
    debug('found %s, trying to register', filePath);

    let repositoryPath = join(packagePath, '..');
    if (basename(repositoryPath).startsWith('@')) {
      // Scoped package
      repositoryPath = join(repositoryPath, '..');
    }

    let namespace = asNamespace(relative(repositoryPath, filePath), { lookups });
    if (registerToScope && !namespace.startsWith('@')) {
      namespace = `@${registerToScope}/${namespace}`;
    }

    const resolved = realpathSync(filePath);
    if (!namespace) {
      namespace = asNamespace(resolved, { lookups });
    }

    env.store.add({ namespace, packagePath, resolved });
    return env.getGeneratorMeta(namespace);
  } catch (error) {
    console.error('Unable to register %s (Error: %s)', filePath, error);
    return false;
  }
}

/**
 * Get or create an alias.
 *
 * Alias allows the `get()` and `lookup()` methods to search in alternate
 * filepath for a given namespaces. It's used for example to map `generator-*`
 * npm package to their namespace equivalent (without the generator- prefix),
 * or to default a single namespace like `angular` to `angular:app` or
 * `angular:all`.
 *
 * Given a single argument, this method acts as a getter. When both name and
 * value are provided, acts as a setter and registers that new alias.
 *
 * If multiple alias are defined, then the replacement is recursive, replacing
 * each alias in reverse order.
 *
 * An alias can be a single String or a Regular Expression. The finding is done
 * based on .match().
 *
 * @param {String|RegExp} match
 * @param {String} value
 *
 * @example
 *
 *     env.alias(/^([a-zA-Z0-9:\*]+)$/, 'generator-$1');
 *     env.alias(/^([^:]+)$/, '$1:app');
 *     env.alias(/^([^:]+)$/, '$1:all');
 *     env.alias('foo');
 *     // => generator-foo:all
 */
resolver.alias = function (match, value) {
  if (match && value) {
    this.aliases.push({
      match: match instanceof RegExp ? match : new RegExp(`^${match}$`),
      value,
    });
    return this;
  }

  const aliases = [...this.aliases].reverse();

  return aliases.reduce((resolved, alias) => {
    if (!alias.match.test(resolved)) {
      return resolved;
    }

    return resolved.replace(alias.match, alias.value);
  }, match);
};
