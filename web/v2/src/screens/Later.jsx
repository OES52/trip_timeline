// 아직 새로 만드는 중인 화면. 그동안은 예전 화면(v1)으로 안내
import { TopBar } from '../ui/Shell.jsx';
import { Icon } from '../ui/Icon.jsx';

function Later({ title, what }) {
  return (
    <main class="screen">
      <TopBar><div class="ctx"><b>{title}</b></div></TopBar>
      <div class="scroll">
        <div class="state">
          <h2>{title} 화면은 새로 만드는 중</h2>
          <p>{what}</p>
          <a class="btn btn-plate" href="/">예전 화면에서 보기<Icon name="out" /></a>
        </div>
      </div>
    </main>
  );
}

export const Records = () => <Later title="기록" what="여권 도장, 지출·영수증, 리플레이를 여기로 옮길 예정. 그동안은 예전 화면에서 보면 됨" />;
