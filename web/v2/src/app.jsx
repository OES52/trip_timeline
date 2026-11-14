import { view, user, sync, route } from './data/store.js';
import { TabBar, FirstWho, Booting, LoadError, Locked } from './ui/Shell.jsx';
import { Today } from './screens/Today.jsx';
import { Plan } from './screens/Plan.jsx';
import { Places, Records } from './screens/Later.jsx';
import { Toast } from './ui/Toast.jsx';
import { Dialogs } from './ui/Dialogs.jsx';

const SCREENS = { today: Today, plan: Plan, places: Places, records: Records };

export function App() {
  const s = sync.value;
  if (!view.value) {
    if (s.kind === 'locked') return <Locked />;
    if (s.kind === 'error') return <LoadError />;
    return <Booting />;
  }
  if (!user.value) return <FirstWho />;
  const Screen = SCREENS[route.value.tab] || Today;
  return (
    <div class="app" data-tab={route.value.tab}>
      <Screen />
      <TabBar />
      <Dialogs />
      <Toast />
    </div>
  );
}
