/**
 * @format
 */

import 'react-native-get-random-values';
import './services/diagnostics/installLogCapture';
import { AppRegistry } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent('SafeLinkMesh', () => App);

