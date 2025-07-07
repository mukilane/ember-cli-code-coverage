import { helper } from '@ember/component/helper';

export function emberCliCodeCoverageRegister([rawData]) {
  let coverageData = JSON.parse(rawData);
  window.__coverage__[coverageData.path] = coverageData;
}

export default helper(emberCliCodeCoverageRegister);
