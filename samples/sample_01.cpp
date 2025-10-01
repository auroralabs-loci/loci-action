#include <iostream>
#include <vector>
#include <algorithm>
#include <random>
#include <chrono>

std::vector<int> generate_ids(size_t N, unsigned seed) {
  std::mt19937 rng(seed);
  std::uniform_int_distribution<int> dist(100000, 300000);
  std::vector<int> ids(N);
  for (size_t i = 0; i < N; ++i) {
    ids[i] = dist(rng);
  }
  return ids;
}

size_t count_unique(const std::vector<int>& ids) {
    std::vector<int> seen;
    seen.reserve(ids.size());
    size_t counter = 0;
    for (int id : ids) {
        if (std::find(seen.begin(), seen.end(), id) == seen.end()) {
            seen.push_back(id);
            ++counter;
        }
    }
    return counter;
}

void run_test(size_t N, unsigned seed) {
    auto ids = generate_ids(N, seed);
    size_t unique = count_unique(ids);
    std::cout << "Unique: " << unique << "\n";
}

int main() {
    run_test(200'000, 42);
    return 0;
}
