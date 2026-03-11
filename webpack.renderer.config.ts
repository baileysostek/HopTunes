import type { Configuration } from 'webpack';

import { rules } from './webpack.rules';
import { plugins } from './webpack.plugins';

rules.push(
  {
    test: /\.css$/,
    use: [{ loader: 'style-loader' }, { loader: 'css-loader' }],
  }
);
rules.push(
  {
    test: /\.(png|jpe?g|gif|svg)$/,
    use: [
      {
        loader: 'file-loader',
        options: {
          name: '[path][name].[ext]',
          // This will place the image file in the 'res/' sub-folder within the build output.
          // Example: /.webpack/renderer/res/shrimp.png
          outputPath: 'res/',
          // The public path needs to match the new location.
          // Example: /renderer/main_window/res/shrimp.png
          // The 'renderer/main_window/' part is handled by Electron Forge's default config.
          // We just need to ensure the path within that is correct.
          // Changing this to a relative path for simplicity.
          publicPath: '../res/', 
        },
      },
    ],
  },
)

export const rendererConfig: Configuration = {
  module: {
    rules,
  },
  plugins,
  resolve: {
    extensions: ['.js', '.ts', '.jsx', '.tsx', '.css'],
  },
};
