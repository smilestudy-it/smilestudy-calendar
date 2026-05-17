/**
 * （責務）dayjs の再エクスポート等、日付ライブラリ周りの小さな集約。
 */
import dayjs from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

// プラグインを読み込む
dayjs.extend(utc);
dayjs.extend(timezone);

// デフォルトのタイムゾーンを日本に設定
dayjs.tz.setDefault("Asia/Tokyo");

export default dayjs;