import { useRoute } from './router';
import Archive from './screens/Archive';
import Game from './screens/Game';

export default function App() {
  const route = useRoute();
  return route.screen === 'play' ? <Game key={route.slug} slug={route.slug} /> : <Archive />;
}
