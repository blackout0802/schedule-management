<?php
// テスト用の画像（画像の添付のテスト用）を作る: php images.php 出力先フォルダ
$d = rtrim($argv[1] ?? sys_get_temp_dir(), '/');
@mkdir($d, 0777, true);
// 大きい画像（スクリーンショット想定。ノイズ入りで、容量も大きい）
$w = 2400; $h = 1500; $im = imagecreatetruecolor($w, $h);
mt_srand(7);
imagefilledrectangle($im, 0, 0, $w, $h, imagecolorallocate($im, 240, 244, 250));
for ($i = 0; $i < 4000; $i++) { imagefilledrectangle($im, mt_rand(0, $w), mt_rand(0, $h), mt_rand(0, $w), mt_rand(0, $h), imagecolorallocate($im, mt_rand(0, 255), mt_rand(0, 255), mt_rand(0, 255))); }
imagepng($im, "$d/shot-big.png", 1);
$s = imagecreatetruecolor(320, 200); imagefilledrectangle($s, 0, 0, 320, 200, imagecolorallocate($s, 30, 120, 220)); imagestring($s, 5, 20, 90, 'small screenshot', imagecolorallocate($s, 255, 255, 255));
imagepng($s, "$d/shot-small.png");
file_put_contents("$d/not-image.txt", "これは画像ではありません\n");
