'use strict';

var path = require('path');
var TestExclude = require('test-exclude');
var TemplateCoverage = require('./template-coverage');

const HELPERS = {
  INCREMENT: 'ember-cli-code-coverage-increment',
  REGISTER: 'ember-cli-code-coverage-register',
};

module.exports = function (appRoot, templateExtensions, include, exclude) {
  const _exclude = new TestExclude({
    cwd: appRoot,
    include,
    exclude,
    extension: templateExtensions,
  });

  return function (options) {
    let self = {};
    self.options = options;
    self.syntax = options.syntax;
    let moduleName = options.meta.moduleName;
    // console.trace(options)
    if (!moduleName) {
      return {
        visitor: {},
      };
    }

    self.relativePath = moduleName;
    self.fullPath = path.join(appRoot, moduleName);
    self.isTemplateTag =
      moduleName.endsWith('.js') && !moduleName.includes('-test.js');

    self.cov = new TemplateCoverage(self.fullPath, options.contents);

    self.shouldInstrument = () => {
      return self.relativePath && _exclude.shouldInstrument(self.relativePath);
    };

    self.currentContainer = () => {
      return self._containerStack[self._containerStack.length - 1];
    };

    /* ----------------------------- HELPER METHODS ----------------------------- */
    self.insertStatementHelper = (node) => {
      let container = self.currentContainer();
      let children = container.body || container.children;
      let index = children ? children.indexOf(node) : 0;

      let helper = self.createHelper(null, {
        statement: self.cov._currentStatement,
      });

      container._statementsToInsert = container._statementsToInsert || [];
      container._statementsToInsert.unshift({
        helper,
        index,
      });
    };

    self.processStatementsToInsert = (node) => {
      if (node._statementsToInsert) {
        node._statementsToInsert.forEach((statement) => {
          let { helper, index } = statement;

          let children = node.children || node.body;
          children && children.splice(index, 0, helper);
        });
      }
    };

    self.insertBranchHelper = (
      branchNode,
      parentNode,
      branchIndex,
      inline,
      params
    ) => {
      let helper = self.createHelper(
        params,
        {
          branch: self.cov._currentBranch,
          condition: branchIndex,
        },
        inline
      );

      if (inline) {
        return helper;
      }

      branchNode.body.unshift(helper);
    };

    self.handleStatement = (node) => {
      if (node.isCoverageHelper) {
        return;
      }

      if (node.type === 'TextNode' && node.chars.trim() === '') {
        return;
      }

      // if (self.currentContainer()._ignoreCoverage) { return; }

      // cannot process statements without a loc
      if (!node.loc) {
        return;
      }

      if (node.loc.start.line == null) {
        return;
      }

      if (
        node.path &&
        node.path.type == 'PathExpression' &&
        node.path.original.match(/if|unless/) &&
        node.params.length > 1
      ) {
        // if else statement
        let branchIndex = self.cov.newBranch(node);
        self.cov.newBranchPath(branchIndex, node.params[1]);
        let helper = self.insertBranchHelper(node.program, node, 0, true, [
          node.params[1],
        ]);
        node.params[1] = helper;

        if (node.params[2]) {
          self.cov.newBranchPath(branchIndex, node.params[2]);
          let helper = self.insertBranchHelper(node.program, node, 1, true, [
            node.params[2],
          ]);
          node.params[2] = helper;
        }
      } else {
        self.cov.newStatement(node);
        self.insertStatementHelper(node);
      }
    };

    self.handleBlock = (node) => {
      // cannot process blocks without a loc
      if (!node.loc) {
        return;
      }

      if (node.isCoverageHelper) {
        return;
      }

      self.handleStatement(node);

      if (node.type === 'BlockStatement') {
        let branchIndex = self.cov.newBranch(node);
        self.cov.newBranchPath(branchIndex, node.program);
        self.insertBranchHelper(node.program, node, 0);

        if (node.inverse) {
          self.cov.newBranchPath(branchIndex, node.inverse);
          self.insertBranchHelper(node.inverse, node, 1);
        }
      }
    };

    self.register = () => {
      let helperPath = b.path(HELPERS.REGISTER);
      if (self.isTemplateTag) {
        helperPath = self.options.meta.jsutils.bindImport(
          'ember-cli-code-coverage/helpers/ember-cli-code-coverage-register',
          'default',
          path,
          { nameHint: 'emberCliCodeCoverageRegister' }
        );
      }

      let helper = b.mustache(helperPath, [
        b.string(JSON.stringify(self.cov.data)),
      ]);

      helper.isCoverageHelper = true;
      return helper;
    };

    self.createHelper = (params, hash, isInline) => {
      const b = self.syntax.builders;

      if (hash) {
        hash = b.hash(
          Object.keys(hash).map((key) => b.pair(key, b.string(hash[key])))
        );
        hash.pairs.push(b.pair('path', b.string(self.fullPath)));
      }

      let helperPath = b.path(HELPERS.INCREMENT);
      if (self.isTemplateTag) {
        helperPath = self.options.meta.jsutils.bindImport(
          'ember-cli-code-coverage/helpers/ember-cli-code-coverage-increment',
          'default',
          path,
          { nameHint: 'emberCliCodeCoverageIncrement' }
        );
      }

      let helper = b[isInline ? 'sexpr' : 'mustache'](
        helperPath,
        isInline
          ? params
          : params && params.map((p) => b.string(JSON.stringify(p))),
        hash
      );

      helper.isCoverageHelper = true;
      return helper;
    };

    let handleStatement = (node) => self.handleStatement(node);
    const b = self.syntax.builders;

    return {
      name: 'template-instrumenter',
      visitor: {
        Program: {
          enter: (node) => {
            if (!self._topLevelProgram) {
              self._topLevelProgram = node;
              self._containerStack = [node];
            } else {
              self._containerStack.push(node);
            }
          },
          exit: (node) => {
            self.processStatementsToInsert(node);
            if (node === self._topLevelProgram) {
              let helper = self.register();
              node.body.unshift(helper);
            }

            self._containerStack.pop(node);
          },
        },
        ElementNode: {
          enter: (node) => {
            self.handleBlock(node);
            self._containerStack.push(node);
          },
          exit: (node) => {
            self.processStatementsToInsert(node);
            self._containerStack.pop();
          },
        },
        BlockStatement: {
          enter: (node) => {
            self.handleBlock(node);
            self._containerStack.push(node);
          },
          exit: (node) => {
            self.processStatementsToInsert(node);
            self._containerStack.pop();
          },
        },
        MustacheStatement: handleStatement,
        TextNode: handleStatement,
        ElementModifierStatement: (node) => {
          const helper = self.createHelper(
            [node.params[1]],
            {
              action: true,
              statement: self.cov.newStatement(node),
            },
            true
          );

          node.params[1] = helper;
        },
        AttrNode: {
          enter: (node) => {
            if (node.value && node.value.type === 'TextNode') {
              return;
            }
            self._containerStack.push(node);
          },
          exit: (node) => {
            if (node.value && node.value.type === 'TextNode') {
              return;
            }
            self._containerStack.pop();
          },
        },
      },
    };
  };
};
