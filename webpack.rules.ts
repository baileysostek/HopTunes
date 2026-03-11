import type { ModuleOptions } from 'webpack';

export const rules: Required<ModuleOptions>['rules'] = [
  // Add support for native node modules
  {
    // We're specifying native_modules in the test because the asset relocator loader generates a
    // "fake" .node file which is really a cjs file.
    test: /native_modules[/\\].+\.node$/,
    use: 'node-loader',
  },
  {
    test: /[/\\]node_modules[/\\].+\.(m?js|node)$/,
    parser: { amd: false },
    use: {
      loader: '@vercel/webpack-asset-relocator-loader',
      options: {
        outputAssetBase: 'native_modules',
      },
    },
  },
  {
    test: /\.tsx?$/,
    exclude: /(node_modules|\.webpack)/,
    use: {
      loader: 'ts-loader',
      options: {
        transpileOnly: true,
      },
    },
  },
  {
    test: /\.svg$/i,
    issuer: /\.[jt]sx?$/, // only handle SVG imports from TS/JS files
    use: [
      {
        loader: '@svgr/webpack',
        options: {
          svgo: true,
          svgoConfig: {
            plugins: [
              {
                name: 'removeViewBox',
                active: false,
              },
            ],
          },
        },
      },
      {
        loader: 'file-loader', // emits the file, gives back a URL for default import
        options: {
          name: 'static/media/[name].[hash:8].[ext]',
        },
      },
    ],
  },
];
