'use strict';

module.exports = {
  name: require('./package').name,
  options: {
    babel: {
      // eslint-disable-next-line node/no-unpublished-require
      plugins: [...require('ember-cli-code-coverage').buildBabelPlugin()],
    },
  },

  setupPreprocessorRegistry(type, registry) {
    registry.add(
      'htmlbars-ast-plugin',
      // eslint-disable-next-line node/no-unpublished-require
      require('ember-cli-code-coverage').buildTemplatePlugin()
    );
  },
};
